const fs=require("fs");
const s=fs.readFileSync("c:\\Users\\agama\\OneDrive\\ドキュメント\\Nexus Core Ai\\static\\js\\script.js","utf8");
console.log((s.match(/`/g)||[]).length);
