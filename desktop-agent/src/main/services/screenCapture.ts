import screenshot from "screenshot-desktop";
import { nativeImage, screen } from "electron";

export interface ScreenFrame {
  buffer: Buffer;
  base64: string;
  width: number;
  height: number;
}

export async function captureScreen(): Promise<ScreenFrame> {
  const buffer = await screenshot({ format: "png" });
  const image = nativeImage.createFromBuffer(buffer);
  const size = image.getSize();
  const display = screen.getPrimaryDisplay();
  const width = size.width || display.workAreaSize.width;
  const height = size.height || display.workAreaSize.height;
  return {
    buffer,
    base64: buffer.toString("base64"),
    width,
    height
  };
}
