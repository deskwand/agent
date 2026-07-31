import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  ChannelAdapterFactory,
} from "./channel-adapter";
import type { RuntimeChannelType } from "./contracts";

export class ChannelRegistry {
  private readonly factories = new Map<
    RuntimeChannelType,
    ChannelAdapterFactory
  >();

  register(type: RuntimeChannelType, factory: ChannelAdapterFactory): void {
    if (this.factories.has(type)) {
      throw new Error(`CHANNEL_ADAPTER_ALREADY_REGISTERED:${type}`);
    }
    this.factories.set(type, factory);
  }

  create(
    config: ChannelAdapterConfig,
    generation: number,
  ): ChannelAdapter {
    const factory = this.factories.get(config.channelType);
    if (!factory) {
      throw new Error(`ADAPTER_NOT_REGISTERED:${config.channelType}`);
    }
    return factory(config, generation);
  }

  has(type: RuntimeChannelType): boolean {
    return this.factories.has(type);
  }
}
