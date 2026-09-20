import ts from 'typescript';
import path from 'node:path';
import catalog from '../utils/translations.json';

/** Translate source-authored UI copy only. User/project strings and symbol
 * glyphs are never inspected or changed; there is no DOM MutationObserver. */
export function localizeUI() {
  return { name: 'abai-localized-copy', enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?')[0];
      if (!/\.[jt]sx?$/.test(file) || /node_modules|scripts|tests|locale\.ts|fonts\.ts|symbol/.test(file)) return;
      if (!file.includes('/components/') && !file.includes('/utils/') && !file.endsWith('/App.tsx')) return;
      const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true,
        file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const edits: { start: number; end: number; text: string }[] = [];
      const known = (s: string) => Object.hasOwn(catalog, s);
      const call = (s: string, args: string[] = []) => `__uiT(${[JSON.stringify(s), ...args].join(',')})`;
      function visit(n: ts.Node) {
        if (ts.isJsxText(n)) {
          const text = n.text.replace(/\s+/g, ' ').trim();
          if (known(text)) edits.push({ start: n.pos, end: n.end, text: `{${call(text)}}` });
          return;
        }
        if (ts.isTemplateExpression(n)) {
          const key = n.head.text + n.templateSpans.map((s,i) => `{${i}}${s.literal.text}`).join('');
          if (known(key)) {
            edits.push({ start: n.getStart(source), end: n.end, text: call(key, n.templateSpans.map(s=>s.expression.getText(source))) });
            return;
          }
        }
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && known(n.text)) {
          const p = n.parent;
          // Property keys, type literals and import paths are program structure.
          if (ts.isLiteralTypeNode(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p)
            || (ts.isPropertyAssignment(p) && p.name === n) || ts.isCaseClause(p)) return;
          const text = ts.isJsxAttribute(p) ? `{${call(n.text)}}` : call(n.text);
          edits.push({ start: n.getStart(source), end: n.end, text }); return;
        }
        ts.forEachChild(n, visit);
      }
      visit(source);
      if (!edits.length) return;
      let result = code;
      for (const e of edits.sort((a,b)=>b.start-a.start)) result = result.slice(0,e.start)+e.text+result.slice(e.end);
      const imp = path.relative(path.dirname(file), path.resolve('utils/locale.ts')).replaceAll('\\','/');
      return { code: `import {t as __uiT} from ${JSON.stringify(imp.startsWith('.') ? imp : './'+imp)};\n`+result, map: null };
    },
  };
}
