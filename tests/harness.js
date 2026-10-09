// Loads the lib/*.js model files the way the QML engine does, for node tests.
//
// The files are QML `.pragma library` scripts: top-level declarations plus
// `.import "Other.js" as Other` lines, neither of which is JavaScript. Each
// file is wrapped in a function whose parameters are its imports, with the
// directives stripped; the wrapper returns every top-level `function` and
// `var` by name, which gives back a module-shaped namespace. Running in this
// realm (not a fresh VM context) keeps arrays and objects deepStrictEqual-
// comparable with test literals.

const fs = require("fs")
const path = require("path")
const vm = require("vm")

const LIB = path.join(__dirname, "..", "lib")
const cache = {}

function load(file) {
  if (cache[file]) return cache[file]
  const source = fs.readFileSync(path.join(LIB, file), "utf8")

  const imports = []
  const importRe = /^\s*\.import\s+"([^"]+)"\s+as\s+(\w+)\s*$/gm
  let match
  while ((match = importRe.exec(source)) !== null) imports.push({ file: match[1], name: match[2] })

  const body = source
    .replace(/^\s*\.pragma\s+library\s*$/m, "")
    .replace(/^\s*\.import\s+.*$/gm, "")

  const names = new Set()
  const declRe = /^(?:function\s+(\w+)|var\s+(\w+))/gm
  while ((match = declRe.exec(body)) !== null) names.add(match[1] || match[2])

  const exported = Array.from(names).map((n) => `${n}: typeof ${n} === "undefined" ? undefined : ${n}`).join(", ")
  const wrapper = `(function(${imports.map((i) => i.name).join(", ")}) {\n${body}\nreturn { ${exported} }\n})`
  const factory = vm.runInThisContext(wrapper, { filename: "lib/" + file })
  const namespace = factory(...imports.map((i) => load(i.file)))
  cache[file] = namespace
  return namespace
}

module.exports = { load }
