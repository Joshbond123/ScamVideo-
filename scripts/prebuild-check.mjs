import fs from 'node:fs';
import ts from 'typescript';

const filesToCheck = [
  'package.json',
  'render.yaml',
  'server/scheduler.ts',
  'server/services/facebookService.ts',
  'server/services/videoService.ts',
  'src/pages/Settings.tsx',
];

const conflictMarkers = ['<<<<<<<', '=======', '>>>>>>>'];

for (const file of filesToCheck) {
  const src = fs.readFileSync(file, 'utf8');
  for (const marker of conflictMarkers) {
    if (src.includes(marker)) {
      console.error(`[prebuild-check] Merge conflict marker found in ${file}: ${marker}`);
      process.exit(1);
    }
  }
}

try {
  JSON.parse(fs.readFileSync('package.json', 'utf8'));
} catch (error) {
  console.error('[prebuild-check] package.json is not valid JSON.');
  console.error(error);
  process.exit(1);
}

function checkTypeScriptSyntax(fileName, scriptKind) {
  const source = fs.readFileSync(fileName, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName,
    reportDiagnostics: true,
  });

  const diagnostics = (result.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) {
    console.error(`[prebuild-check] Syntax diagnostics detected in ${fileName}:`);
    for (const diag of diagnostics) {
      const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
      console.error(`  - TS${diag.code}: ${message}`);
    }
    process.exit(1);
  }
}

checkTypeScriptSyntax('server/scheduler.ts', ts.ScriptKind.TS);
checkTypeScriptSyntax('server/services/facebookService.ts', ts.ScriptKind.TS);
checkTypeScriptSyntax('server/services/videoService.ts', ts.ScriptKind.TS);
checkTypeScriptSyntax('src/pages/Settings.tsx', ts.ScriptKind.TSX);

console.log('[prebuild-check] Merge/syntax checks passed for package/render + scheduler/facebook/video/settings files.');
