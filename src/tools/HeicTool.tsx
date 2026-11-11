import { ConvertImageTool } from "./ConvertImageTool";

/** The HEIC landing page reuses the conversion engine with JPG as the default. */
export function HeicTool() {
  return <ConvertImageTool defaultFormat="jpeg" heicMode />;
}
