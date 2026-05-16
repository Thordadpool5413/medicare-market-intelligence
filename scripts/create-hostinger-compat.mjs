import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const buildDir = path.join(root, "build");

await fs.mkdir(buildDir, { recursive: true });

await fs.writeFile(
  path.join(buildDir, "index.js"),
  `import http from "node:http";\nimport fs from "node:fs";\nimport path from "node:path";\nimport { fileURLToPath } from "node:url";\n\nconst __filename = fileURLToPath(import.meta.url);\nconst __dirname = path.dirname(__filename);\nconst distDir = path.resolve(__dirname, "..", "dist");\nconst port = Number(process.env.PORT || 3000);\n\nconst mimeTypes = {\n  ".html": "text/html",\n  ".js": "text/javascript",\n  ".css": "text/css",\n  ".json": "application/json",\n  ".png": "image/png",\n  ".jpg": "image/jpeg",\n  ".jpeg": "image/jpeg",\n  ".svg": "image/svg+xml",\n  ".ico": "image/x-icon"\n};\n\nconst server = http.createServer((request, response) => {\n  const requestedPath = decodeURIComponent((request.url || "/").split("?")[0]);\n  let filePath = path.join(distDir, requestedPath === "/" ? "index.html" : requestedPath);\n\n  if (!filePath.startsWith(distDir)) {\n    response.writeHead(403);\n    response.end("Forbidden");\n    return;\n  }\n\n  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {\n    filePath = path.join(distDir, "index.html");\n  }\n\n  const ext = path.extname(filePath);\n  response.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });\n  fs.createReadStream(filePath).pipe(response);\n});\n\nserver.listen(port, () => {\n  console.log(\`Medicare Market Intelligence static server running on port \${port}\`);\n});\n`
);

await fs.writeFile(
  path.join(buildDir, "web.js"),
  `export const appName = "Medicare Market Intelligence";\nexport const buildOutput = "dist";\n`
);

console.log("Created Hostinger compatibility files in build/index.js and build/web.js");
