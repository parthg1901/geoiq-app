/**
 * On-screen keyboard awareness. Android resizes the app around the keyboard, so we watch the
 * viewport height while a text field is focused and toggle `html.kb-open`; CSS then hides the
 * nav bar and shrinks big visuals so the question *and* the input both fit.
 */
const isText = (el: Element | null) =>
  !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'range', 'submit'].includes((el as HTMLInputElement).type)));

export function initKeyboard() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const height = () => vv?.height ?? window.innerHeight;
  // Tallest height seen per orientation = "keyboard closed" baseline.
  const full: Record<string, number> = {};
  const orient = () => (window.innerWidth > window.innerHeight + 100 ? 'land' : 'port');

  let open = false;
  const update = () => {
    const o = orient();
    const h = height();
    if (!isText(document.activeElement)) full[o] = Math.max(full[o] ?? 0, h);
    const base = full[o] ?? h;
    const next = isText(document.activeElement) && base - h > 120;
    if (next !== open) {
      open = next;
      root.classList.toggle('kb-open', open);
      // Keep the focused field visible once the layout has adjusted.
      if (open) setTimeout(() => (document.activeElement as HTMLElement | null)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    }
  };
  vv?.addEventListener('resize', update);
  window.addEventListener('resize', update);
  document.addEventListener('focusin', () => setTimeout(update, 250));
  document.addEventListener('focusout', () => setTimeout(update, 50));
  update();
}
