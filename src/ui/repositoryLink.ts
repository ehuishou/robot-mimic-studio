import './repositoryLink.css';

/** Shared footer action; private-repository access still depends on the visitor's GitHub account. */
export function repositoryLink(): string {
  return '<a class="repository-link" href="https://github.com/ehuishou/robot-mimic-studio" target="_blank" rel="noopener noreferrer" aria-label="打开 GitHub 仓库（新标签页）" title="GitHub · robot-mimic-studio"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.104.77-.244.77-.542 0-.267-.01-.975-.015-1.915-3.13.68-3.79-1.508-3.79-1.508-.512-1.3-1.25-1.646-1.25-1.646-1.022-.698.078-.684.078-.684 1.13.08 1.725 1.16 1.725 1.16 1.005 1.722 2.637 1.224 3.28.936.102-.727.394-1.224.716-1.505-2.499-.284-5.126-1.25-5.126-5.565 0-1.23.44-2.234 1.16-3.021-.116-.285-.503-1.43.11-2.98 0 0 .945-.303 3.094 1.153A10.783 10.783 0 0 1 12 6.18c.956.004 1.918.13 2.817.379 2.148-1.456 3.09-1.153 3.09-1.153.615 1.55.228 2.695.112 2.98.722.787 1.158 1.79 1.158 3.021 0 4.326-2.632 5.278-5.14 5.557.404.35.765 1.042.765 2.1 0 1.516-.014 2.739-.014 3.111 0 .3.203.651.774.54A11.252 11.252 0 0 0 12 .75Z"/></svg><span>GitHub</span></a>';
}
