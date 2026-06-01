import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseEpub } from "./epub";

describe("parseEpub", () => {
  it("extracts metadata, spine chapters, ruby-free text, and sentences", async () => {
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
          <dc:creator>著者</dc:creator>
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
          <p><ruby>猫<rt>ねこ</rt></ruby>が走る。犬も走る！</p>
        </body>
      </html>`,
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const book = await parseEpub(buffer, "fixture.epub");

    expect(book.title).toBe("小さな本");
    expect(book.author).toBe("著者");
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].sentences.map((sentence) => sentence.text)).toEqual([
      "猫が走る。",
      "犬も走る！",
    ]);
    expect(book.chapters[0].sentences[0].tokens.map((token) => token.text).join("")).toBe(
      "猫が走る。",
    );
    expect(book.tokenizerVersion).toBeDefined();
  });

  it("honors spine order and skips non-readable manifest items", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?>
      <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles>
          <rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/>
        </rootfiles>
      </container>`,
    );
    zip.file(
      "OPS/book.opf",
      `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>順番</dc:title></metadata>
        <manifest>
          <item id="image" href="Images/cover.jpg" media-type="image/jpeg"/>
          <item id="second" href="Text/second.xhtml" media-type="application/xhtml+xml"/>
          <item id="first" href="Text/first.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
          <itemref idref="image"/>
          <itemref idref="second"/>
          <itemref idref="first"/>
        </spine>
      </package>`,
    );
    zip.file("OPS/Images/cover.jpg", "");
    zip.file("OPS/Text/second.xhtml", `<html><body><p>二番目。</p></body></html>`);
    zip.file("OPS/Text/first.xhtml", `<html><body><p>一番目。</p></body></html>`);

    const book = await parseEpub(await zip.generateAsync({ type: "arraybuffer" }), "order.epub");

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["二番目。", "一番目。"]);
    expect(book.chapters.flatMap((chapter) => chapter.sentences).map((sentence) => sentence.globalIndex)).toEqual([
      0,
      1,
    ]);
  });

  it("throws a useful error when the EPUB has no readable chapters", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?>
      <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles>
          <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
        </rootfiles>
      </container>`,
    );
    zip.file(
      "content.opf",
      `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>空</dc:title></metadata>
        <manifest><item id="cover" href="cover.jpg" media-type="image/jpeg"/></manifest>
        <spine><itemref idref="cover"/></spine>
      </package>`,
    );
    zip.file("cover.jpg", "");

    await expect(
      parseEpub(await zip.generateAsync({ type: "arraybuffer" }), "empty.epub"),
    ).rejects.toThrow("No readable text chapters");
  });
});
