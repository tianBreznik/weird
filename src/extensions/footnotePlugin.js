import { Extension } from '@tiptap/core';
import { InputRule } from 'prosemirror-inputrules';

// Extension to handle ^["content"] syntax and auto-number footnotes
// MINIMAL VERSION: Only InputRule, no Plugin registration to avoid typing interference
export const FootnotePlugin = Extension.create({
  name: 'footnote',
  
  // REMOVED: addProseMirrorPlugins - empty plugin was interfering with typing
  // We don't need the plugin for just the InputRule functionality
  
  addInputRules() {
    return [
      new InputRule({
        // Match legacy markdown-style syntax: ^[content]
        // We allow anything except a closing bracket inside.
        find: /\^\[([^\]]+)\]$/,
        handler: ({ state, range, match }) => {
          const content = match[1]?.trim();
          if (!content) {
            return null;
          }
          
          // OPTIMIZED: Only scan for footnotes in a limited range around the insertion point
          // instead of scanning the entire document
          let maxNumber = 0;
          const { from } = range;
          
          // Scan a reasonable window around the insertion point for existing footnotes
          // This avoids scanning the entire document on every conversion
          const scanFrom = Math.max(0, from - 1000);
          const scanTo = Math.min(state.doc.content.size, from + 1000);
          
          state.doc.nodesBetween(scanFrom, scanTo, (node) => {
            if (node.type.name === 'footnoteRef' && node.attrs.number) {
              maxNumber = Math.max(maxNumber, node.attrs.number);
            }
          });
          
          // Also do a quick global count to ensure we don't miss any
          // But only count, don't traverse - much faster
          let globalCount = 0;
          state.doc.descendants((node) => {
            if (node.type.name === 'footnoteRef') globalCount++;
          });
          
          // If we found footnotes nearby, use max. Otherwise, use count as number
          const number = maxNumber > 0 ? maxNumber + 1 : globalCount + 1;
          const id = `fn-${number}`;
          
          // Create footnote reference node
          const footnoteNode = state.schema.nodes.footnoteRef.create({
            id,
            number,
            content,
          });
          
          // Replace the matched text with the footnote node
          const { to } = range;
          const tr = state.tr.replaceWith(from, to, footnoteNode);
          
          // Emit event for parent component if needed
          const event = new CustomEvent('footnote-created', {
            detail: { id, number, content },
          });
          document.dispatchEvent(event);
          
          return tr;
        },
      }),
    ];
  },
});

