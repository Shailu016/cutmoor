import { ConvertImageTool } from "../ConvertImageTool";

/**
 * One page per common conversion. They all run the same converter as Convert image; each only narrows the file picker and
 * the starting format to what the page is about, so a visitor searching "WebP to JPG" lands on exactly that.
 */

export const WebpToJpg = () => (
  <ConvertImageTool defaultFormat="jpeg" accept="image/webp,.webp" hint="A .webp file. It is saved as a JPG that opens everywhere." formats={["jpeg", "png"]} />
);

export const PngToJpg = () => (
  <ConvertImageTool defaultFormat="jpeg" accept="image/png,.png" hint="A .png file. Transparent areas are filled with a colour you choose." formats={["jpeg", "webp"]} />
);

export const JpgToPng = () => (
  <ConvertImageTool defaultFormat="png" accept="image/jpeg,.jpg,.jpeg" hint="A .jpg file. It is saved as a lossless PNG." formats={["png", "webp"]} />
);

export const SvgToPng = () => (
  <ConvertImageTool defaultFormat="png" accept="image/svg+xml,.svg" hint="An .svg file. It is drawn at its own size and saved as a PNG." formats={["png", "jpeg"]} />
);

export const AvifToJpg = () => (
  <ConvertImageTool defaultFormat="jpeg" accept="image/avif,.avif" hint="An .avif file. Needs a browser that can show AVIF, such as current Chrome, Edge, or Firefox." formats={["jpeg", "png"]} />
);
