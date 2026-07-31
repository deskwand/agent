/**
 * Remote Control Settings Panel
 *
 * Manages Channel Runtime instances (feishu / telegram / discord / qq /
 * slack / wechat) through the channel instance catalog.
 */

import { ChannelInstanceCatalog } from "./remote/ChannelInstanceCatalog";

export function RemoteControlPanel({ isActive }: { isActive: boolean }) {
  void isActive;
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <ChannelInstanceCatalog />
    </div>
  );
}
