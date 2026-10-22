// Runs the real Monight reader (index.html markup and src/main.ts) in a browser,
// with Tauri's native side replaced by an in-memory substitute, so the EmbedPDF
// Playwright checks can drive the reader chrome end to end: toolbar, sidebar
// modes, search, markup toolbar, Highlight split button, the annotation menu,
// and the native menus' Reader Command path (`reader-command` events).

import { emit } from '@tauri-apps/api/event';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { navigationPdf } from './__fixtures__/navigation-pdf';

interface Invocation {
  readonly cmd: string;
  readonly args: unknown;
}

declare global {
  interface Window {
    chromeSmoke?: {
      /** Every native command the reader invoked, in order. */
      readonly invocations: Invocation[];
      /** Every error toast the reader showed. */
      readonly errorToasts: string[];
      /** The paths the next Open dialog returns. */
      chooseFiles(paths: readonly string[]): void;
      /** Runs a native menu item as a click on it would (View, Go, Tools, Edit). */
      runMenuCommand(id: string): Promise<void>;
      /** The PDF bytes last written over a Document's file by Save. */
      savedBytes(path: string): number[] | null;
      /** A native menu item's state as the reader last set it (enabled, checked, title). */
      menuItem(id: string): Record<string, unknown> | null;
    };
  }
}

const files = new Map<string, Uint8Array>([
  ['/smoke/moon.pdf', navigationPdf('Moon chrome fixture', 0, true)],
  ['/smoke/sun.pdf', navigationPdf('Sun chrome fixture', 0, false)],
]);
const saved = new Map<string, number[]>();
const sources = new Map<string, string>();
const stores = new Map<number, Map<string, unknown>>();
const storePaths = new Map<string, number>();
const invocations: Invocation[] = [];
const menuItems = new Map<string, Record<string, unknown>>();
const errorToasts: string[] = [];
let chosenFiles: string[] = [];

const bytesOf = (value: unknown): number[] =>
  Array.isArray(value) ? (value as number[]) : Array.from(new Uint8Array(value as ArrayBuffer));

const store = (rid: unknown) => {
  const entries = stores.get(Number(rid));
  if (!entries) throw new Error(`Unknown store ${String(rid)}`);
  return entries;
};

function handleStore(command: string, args: Record<string, unknown>): unknown {
  switch (command) {
    case 'load': {
      const path = String(args.path);
      let rid = storePaths.get(path);
      if (rid === undefined) {
        rid = storePaths.size + 1;
        storePaths.set(path, rid);
        stores.set(rid, new Map());
      }
      return rid;
    }
    case 'get_store':
      return storePaths.get(String(args.path)) ?? null;
    case 'get': {
      const entries = store(args.rid);
      const key = String(args.key);
      return [structuredClone(entries.get(key)), entries.has(key)];
    }
    case 'set':
      store(args.rid).set(String(args.key), structuredClone(args.value));
      return null;
    case 'has':
      return store(args.rid).has(String(args.key));
    case 'delete':
      return store(args.rid).delete(String(args.key));
    case 'keys':
      return [...store(args.rid).keys()];
    case 'values':
      return [...store(args.rid).values()];
    case 'entries':
      return [...store(args.rid).entries()];
    case 'length':
      return store(args.rid).size;
    case 'clear':
    case 'reset':
      store(args.rid).clear();
      return null;
    default:
      return null;
  }
}

function handleCommand(cmd: string, rawArgs: unknown): unknown {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  invocations.push({ cmd, args: cmd.includes('pdf') ? { path: args.path } : rawArgs });
  if (cmd.startsWith('plugin:store|')) return handleStore(cmd.slice('plugin:store|'.length), args);
  switch (cmd) {
    case 'plugin:app|version':
      return '0.0.0-smoke';
    case 'plugin:app|name':
      return 'Monight';
    case 'plugin:app|tauri_version':
      return '2';
    case 'plugin:window|is_fullscreen':
    case 'plugin:window|is_maximized':
    case 'plugin:window|is_minimized':
      return false;
    case 'plugin:window|scale_factor':
      return 1;
    case 'plugin:window|inner_size':
    case 'plugin:window|outer_size':
      return { width: window.innerWidth, height: window.innerHeight };
    case 'take_application_quit_request':
      return false;
    case 'take_external_open_payloads':
      return [];
    case 'open_pdf_dialog': {
      const paths = chosenFiles;
      chosenFiles = [];
      return paths;
    }
    case 'describe_pdf_file': {
      const path = String(args.path);
      if (!files.has(path)) throw new Error(`No such PDF: ${path}`);
      return { canonicalPath: path, title: path.split('/').pop() };
    }
    case 'read_pdf_file': {
      const path = String(args.path);
      const bytes = saved.get(path) ?? files.get(path);
      if (!bytes) throw new Error(`No such PDF: ${path}`);
      return Array.from(bytes);
    }
    case 'inspect_pdf_editing':
      return null;
    case 'inspect_recovery_draft':
      return { status: 'none', sourceVersion: 'smoke' };
    case 'capture_pdf_source': {
      const token = `source-${sources.size + 1}`;
      sources.set(token, String(args.path));
      return token;
    }
    case 'prepare_pdf_save':
      return bytesOf(args.bytes);
    case 'write_original_pdf': {
      const path = sources.get(String(args.token));
      const bytes = bytesOf(args.bytes);
      if (path) saved.set(path, bytes);
      return bytes;
    }
    case 'print_pdf':
      return null;
    case 'set_menu_item_states':
      for (const item of (args.items ?? []) as Array<Record<string, unknown>>) {
        menuItems.set(String(item.id), { ...menuItems.get(String(item.id)), ...item });
      }
      return null;
    default:
      return null;
  }
}

async function mountReader(): Promise<void> {
  // The reader's own markup, so the chrome under test is exactly what ships.
  const markup = new DOMParser().parseFromString(
    await (await fetch('/index.html')).text(),
    'text/html',
  );
  for (const script of markup.querySelectorAll('script')) script.remove();
  document.title = markup.title;
  document.body.replaceWith(document.adoptNode(markup.body));
  const toasts = document.getElementById('toast-region');
  if (toasts) {
    new MutationObserver((records) => {
      for (const node of records.flatMap(({ addedNodes }) => [...addedNodes])) {
        if (node instanceof HTMLElement && node.classList.contains('toast-error'))
          errorToasts.push(node.textContent ?? '');
      }
    }).observe(toasts, { childList: true });
  }
  mockWindows('main');
  mockIPC(handleCommand, { shouldMockEvents: true });
  window.chromeSmoke = {
    invocations,
    errorToasts,
    chooseFiles(paths) {
      chosenFiles = [...paths];
    },
    runMenuCommand: (id) => emit('reader-command', id),
    savedBytes: (path) => saved.get(path) ?? null,
    menuItem: (id) => menuItems.get(id) ?? null,
  };
  await import('./main');
}

void mountReader();
