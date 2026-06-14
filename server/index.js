import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "0.0.0.0";
const EPUB_LIBRARY_PATH = process.env.EPUB_LIBRARY_PATH
  ? path.resolve(process.env.EPUB_LIBRARY_PATH)
  : null;
const PROGRESS_PATH = path.resolve(
  process.env.MIGAKU_RSVP_PROGRESS_PATH ?? ".migaku-rsvp-progress.json",
);
const DIST_DIR = path.resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const MAX_JSON_BODY_BYTES = 16 * 1024;
const MAX_EPUB_UPLOAD_BYTES = Number(process.env.MAX_EPUB_UPLOAD_BYTES ?? 500 * 1024 * 1024);

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

createServer((request, response) => {
  void routeRequest(request, response).catch((error) => {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error." });
  });
}).listen(PORT, HOST, () => {
  console.log(`Migaku RSVP listening on http://${HOST}:${PORT}`);
  if (EPUB_LIBRARY_PATH) {
    console.log(`EPUB library enabled: ${EPUB_LIBRARY_PATH}`);
    console.log(`Progress store: ${PROGRESS_PATH}`);
  } else {
    console.log("EPUB library disabled. Set EPUB_LIBRARY_PATH to enable server books.");
  }
});

async function routeRequest(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    await routeApiRequest(request, response, url);
    return;
  }

  await serveStaticFile(request, response, url);
}

async function routeApiRequest(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/library/status") {
    const bookCount = EPUB_LIBRARY_PATH ? (await listLibraryBooks()).length : 0;
    sendJson(response, 200, {
      enabled: Boolean(EPUB_LIBRARY_PATH),
      bookCount,
    });
    return;
  }

  if (!EPUB_LIBRARY_PATH) {
    sendJson(response, 404, { error: "Server EPUB library is disabled." });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/books") {
    const books = await listLibraryBooks();
    const progressByBookId = await readProgressStore();
    sendJson(response, 200, books.map((book) => toBookEntry(book, progressByBookId)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/books") {
    const fileName = request.headers["x-file-name"];
    if (typeof fileName !== "string") {
      sendJson(response, 400, { error: "Missing X-File-Name header." });
      return;
    }

    try {
      const book = await saveUploadedEpub(request, fileName);
      const progressByBookId = await readProgressStore();
      sendJson(response, 201, toBookEntry(book, progressByBookId));
    } catch (error) {
      if (error instanceof UploadError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  const fileMatch = url.pathname.match(/^\/api\/books\/([^/]+)\/file$/);
  if (request.method === "GET" && fileMatch) {
    const book = await findLibraryBook(fileMatch[1]);
    if (!book) {
      sendJson(response, 404, { error: "Book not found." });
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/epub+zip",
      "Content-Length": book.size,
      "Content-Disposition": createContentDisposition(book.fileName),
      "Cache-Control": "no-store",
    });
    createReadStream(book.absolutePath).pipe(response);
    return;
  }

  const progressMatch = url.pathname.match(/^\/api\/books\/([^/]+)\/progress$/);
  if (progressMatch) {
    await routeProgressRequest(request, response, progressMatch[1]);
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

async function routeProgressRequest(request, response, bookId) {
  const book = await findLibraryBook(bookId);
  if (!book) {
    sendJson(response, 404, { error: "Book not found." });
    return;
  }

  if (request.method === "GET") {
    const progressByBookId = await readProgressStore();
    sendJson(response, 200, progressByBookId[bookId] ?? emptyProgress());
    return;
  }

  if (request.method !== "PUT") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const body = await readJsonBody(request);
  if (!isReaderPosition(body)) {
    sendJson(response, 400, { error: "Progress must include sentenceIndex and tokenIndex." });
    return;
  }

  const progressByBookId = await readProgressStore();
  progressByBookId[bookId] = body;
  await writeProgressStore(progressByBookId);
  sendJson(response, 200, body);
}

async function serveStaticFile(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const decodedPath = decodeURIComponent(url.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const requestedPath = path.resolve(DIST_DIR, relativePath);
  const safePath = isPathInside(requestedPath, DIST_DIR)
    ? requestedPath
    : path.join(DIST_DIR, "index.html");
  const filePath = (await fileExists(safePath)) ? safePath : path.join(DIST_DIR, "index.html");
  const fileStats = await stat(filePath);
  const contentType = MIME_TYPES.get(path.extname(filePath)) ?? "application/octet-stream";

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fileStats.size,
    "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

async function listLibraryBooks() {
  if (!EPUB_LIBRARY_PATH) {
    return [];
  }

  await mkdir(EPUB_LIBRARY_PATH, { recursive: true });
  const books = [];
  await collectEpubFiles(EPUB_LIBRARY_PATH, "", books);
  return books.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

async function saveUploadedEpub(request, fileName) {
  if (!EPUB_LIBRARY_PATH) {
    throw new UploadError("Server EPUB library is disabled.", 404);
  }

  const safeFileName = sanitizeEpubFileName(fileName);
  await mkdir(EPUB_LIBRARY_PATH, { recursive: true });

  const destinationPath = path.resolve(EPUB_LIBRARY_PATH, safeFileName);
  if (!isPathInside(destinationPath, EPUB_LIBRARY_PATH)) {
    throw new UploadError("Invalid EPUB filename.", 400);
  }

  const tempPath = path.join(EPUB_LIBRARY_PATH, `.${safeFileName}.${process.pid}.upload`);
  let bytesWritten = 0;
  const byteLimit = new Transform({
    transform(chunk, _encoding, callback) {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_EPUB_UPLOAD_BYTES) {
        callback(new UploadError("EPUB upload is too large.", 413));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(request, byteLimit, createWriteStream(tempPath, { flags: "w" }));
    if (bytesWritten === 0) {
      throw new UploadError("Uploaded EPUB is empty.", 400);
    }
    await rename(tempPath, destinationPath);
    const fileStats = await stat(destinationPath);
    return {
      id: createBookId(safeFileName),
      absolutePath: destinationPath,
      relativePath: safeFileName,
      fileName: safeFileName,
      modifiedAt: fileStats.mtime.toISOString(),
      size: fileStats.size,
    };
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function collectEpubFiles(directory, relativeDirectory, books) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      await collectEpubFiles(absolutePath, relativePath, books);
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".epub")) {
      continue;
    }

    const fileStats = await stat(absolutePath);
    books.push({
      id: createBookId(relativePath),
      absolutePath,
      relativePath,
      fileName: entry.name,
      modifiedAt: fileStats.mtime.toISOString(),
      size: fileStats.size,
    });
  }
}

async function findLibraryBook(bookId) {
  const books = await listLibraryBooks();
  return books.find((book) => book.id === bookId) ?? null;
}

async function readProgressStore() {
  try {
    const text = await readFile(PROGRESS_PATH, "utf8");
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeProgressStore(progressByBookId) {
  await mkdir(path.dirname(PROGRESS_PATH), { recursive: true });
  const tempPath = `${PROGRESS_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(progressByBookId, null, 2)}\n`);
  await rename(tempPath, PROGRESS_PATH);
}

function createBookId(relativePath) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  return `server-${createHash("sha256").update(normalizedPath).digest("hex").slice(0, 24)}`;
}

function toBookEntry(book, progressByBookId) {
  return {
    id: book.id,
    fileName: book.fileName,
    relativePath: book.relativePath,
    modifiedAt: book.modifiedAt,
    size: book.size,
    progress: progressByBookId[book.id] ?? emptyProgress(),
  };
}

function emptyProgress() {
  return { sentenceIndex: 0, tokenIndex: 0 };
}

function isReaderPosition(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isSafeInteger(value.sentenceIndex) &&
    Number.isSafeInteger(value.tokenIndex) &&
    value.sentenceIndex >= 0 &&
    value.tokenIndex >= 0
  );
}

function sendJson(response, statusCode, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function isPathInside(candidatePath, directoryPath) {
  const relativePath = path.relative(directoryPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function sanitizeEpubFileName(fileName) {
  let decodedFileName;
  try {
    decodedFileName = decodeURIComponent(fileName);
  } catch {
    throw new UploadError("Invalid EPUB filename.", 400);
  }

  const baseName = path
    .basename(decodedFileName)
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  if (!baseName.toLowerCase().endsWith(".epub")) {
    throw new UploadError("Only .epub uploads are supported.", 400);
  }

  const normalizedName = baseName.length > 0 ? baseName : "book.epub";
  if (normalizedName === ".epub") {
    throw new UploadError("Invalid EPUB filename.", 400);
  }

  return normalizedName;
}

function createContentDisposition(fileName) {
  const fallbackName = fileName.replace(/[^\x20-\x7e]/g, "_").replaceAll('"', '\\"');
  return `inline; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

class UploadError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_JSON_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
