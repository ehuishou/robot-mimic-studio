import './presentation.css';
import { icon } from './icons';

/** Enlarge the existing scene without replacing its canvas or interrupting playback. */
export function mountPresentation(target: HTMLElement, controls: HTMLElement, signal: AbortSignal): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'presentation-toggle';
  let expanded = false;
  const update = (value: boolean) => {
    expanded = value;
    target.classList.toggle('presentation-expanded', expanded);
    document.documentElement.classList.toggle('presentation-open', expanded);
    const label = expanded ? '退出放大' : '放大画面';
    button.innerHTML = icon(expanded ? 'collapse' : 'expand') + '<span>' + label + '</span>';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(expanded));
    button.title = expanded ? '退出放大（Esc）' : label;
  };
  update(false);
  controls.append(button);
  button.addEventListener('click', () => update(!expanded), { signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && expanded) {
      update(false);
      button.focus({ preventScroll: true });
    }
  }, { signal });
  signal.addEventListener('abort', () => {
    update(false);
    button.remove();
  }, { once: true });
}
