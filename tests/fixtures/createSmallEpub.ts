import { promises as fs } from "node:fs";
import pathModule from "node:path";
import JSZip from "jszip";

export async function createSmallEpub(path: string, paragraphs = ["猫が走る。犬も走る。", "鳥は空を見る。"]) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>小さな本</dc:title>
        <dc:creator>Fixture</dc:creator>
      </metadata>
      <manifest>
        <item id="chapter1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="chapter1"/></spine>
    </package>`,
  );
  zip.file(
    "OEBPS/Text/chapter1.xhtml",
    `<?xml version="1.0"?>
    <html xmlns="http://www.w3.org/1999/xhtml">
      <body>
        ${paragraphs.map((paragraph) => `<p>${escapeXml(paragraph)}</p>`).join("\n")}
      </body>
    </html>`,
  );

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await fs.mkdir(pathModule.dirname(path), { recursive: true });
  await fs.writeFile(path, buffer);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
