"""导出 emotion2vec_plus_base：funasr 导出编码器 → 手术追加池化与头部 → int8。

用法：python3 scripts/export-emotion-model.py <模型目录> <输出目录> [--no-surgery]
需要环境：torch==2.2.2 numpy<2 funasr onnx onnxruntime。

--no-surgery 时输出退回形态：encoder.int8.onnx + head.bin（float32 权重与偏置）。
"""
import argparse, os
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
from onnxruntime.quantization import QuantType, quantize_dynamic
from funasr import AutoModel

LABELS_FILE = "labels.txt"


def load_head(model) -> tuple[np.ndarray, np.ndarray]:
    weight = model.proj.weight.detach().numpy().astype(np.float32)   # [9,768]
    bias = model.proj.bias.detach().numpy().astype(np.float32)       # [9]
    return weight, bias


def export_encoder(model_dir: str):
    """funasr 官方导出：变长输入，已含输入层归一化。返回 .onnx 路径与模型。"""
    au = AutoModel(model=model_dir, disable_update=True, device="cpu")
    exported = au.export(type="onnx", quantize=False, opset_version=13, device="cpu")
    src = os.path.join(exported, "emotion2vec")
    if not os.path.exists(src):
        raise SystemExit(f"没找到导出文件: {src}")
    return src, au.model


def append_head(src: str, dst: str, weight: np.ndarray, bias: np.ndarray) -> None:
    """把 ReduceMean + MatMul + Add + Softmax 接到已有图的输出上。

    opset 13 的 ReduceMean 用 axes 属性（不是输入）。
    """
    model = onnx.load(src)
    graph = model.graph
    old_out = graph.output[0].name
    graph.initializer.append(numpy_helper.from_array(weight.T, "head_weight"))  # [768,9]
    graph.initializer.append(numpy_helper.from_array(bias, "head_bias"))        # [9]
    # opset 13 的 Squeeze 把 axes 当**输入张量**（不是属性），所以要给它一个 initializer。
    graph.initializer.append(
        numpy_helper.from_array(np.array([1], dtype=np.int64), "squeeze_axes")
    )
    nodes = [
        helper.make_node("ReduceMean", [old_out], ["tone_pooled"],
                         axes=[-2], keepdims=1, name="tone_pooled"),
        helper.make_node("MatMul", ["tone_pooled", "head_weight"], ["tone_logits3d"],
                         name="tone_matmul"),
        helper.make_node("Add", ["tone_logits3d", "head_bias"], ["tone_logits3d_b"],
                         name="tone_add"),
        helper.make_node("Squeeze", ["tone_logits3d_b", "squeeze_axes"], ["tone_logits"],
                         name="tone_squeeze"),
        helper.make_node("Softmax", ["tone_logits"], ["probabilities"], axis=-1,
                         name="tone_softmax"),
    ]
    graph.node.extend(nodes)
    del graph.output[:]
    graph.output.append(helper.make_tensor_value_info("probabilities", TensorProto.FLOAT,
                                                     ["batch", 9]))
    onnx.checker.check_model(model)
    onnx.save(model, dst)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model_dir")
    parser.add_argument("out_dir")
    parser.add_argument("--no-surgery", action="store_true")
    args = parser.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    src, model = export_encoder(args.model_dir)
    weight, bias = load_head(model)

    if args.no_surgery:
        encoder = os.path.join(args.out_dir, "encoder.int8.onnx")
        quantize_dynamic(src, encoder, weight_type=QuantType.QInt8,
                         op_types_to_quantize=["MatMul", "Gemm"])
        head_path = os.path.join(args.out_dir, "head.bin")
        with open(head_path, "wb") as handle:
            handle.write(weight.tobytes())
            handle.write(bias.tobytes())
        print("退回形态:", encoder, os.path.getsize(encoder), head_path,
              os.path.getsize(head_path))
    else:
        full = os.path.join(args.out_dir, "full.onnx")
        append_head(src, full, weight, bias)
        final = os.path.join(args.out_dir, "emotion2vec.int8.onnx")
        quantize_dynamic(full, final, weight_type=QuantType.QInt8,
                         op_types_to_quantize=["MatMul", "Gemm"])
        os.remove(full)
        print("手术形态:", final, os.path.getsize(final))

    tokens = os.path.join(args.model_dir, "tokens.txt")
    with open(tokens, encoding="utf8") as reader, \
            open(os.path.join(args.out_dir, LABELS_FILE), "w", encoding="utf8") as writer:
        writer.writelines(line for line in reader if line.strip())
    print("标签:", os.path.join(args.out_dir, LABELS_FILE))


if __name__ == "__main__":
    main()
