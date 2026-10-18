import type { App } from "../app.ts";
import type { Settings } from "../settings.ts";

const THUMB_W = 320;
const THUMB_H = 180;
/** Transparent 1×1 GIF, so a thumbnail still rendering shows the black tile rather than a broken image. */
const PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Preset browser: a grid of every preset rendered live at the current moment of the song,
 * so you see what each would look like right here. Click one to apply it.
 */
export class PresetBrowser {
  private readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly app: App;
  private readonly entries: () => [string, Settings][];
  private readonly apply: (name: string) => void;
  private generation = 0;

  constructor(root: HTMLElement, app: App, entries: () => [string, Settings][], apply: (name: string) => void) {
    this.root = root;
    this.app = app;
    this.entries = entries;
    this.apply = apply;
    this.grid = root.querySelector(".grid") as HTMLElement;
    root.addEventListener("click", (e) => {
      if (e.target === root) this.close();
    });
    root.querySelector(".close")?.addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  close(): void {
    this.generation++;
    this.root.hidden = true;
  }

  open(): void {
    const generation = ++this.generation;
    this.root.hidden = false;
    this.grid.replaceChildren();
    const t = this.app.previewTime();
    const queue = this.entries().map(([name, settings]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumb";
      const img = document.createElement("img");
      img.alt = "";
      img.src = PLACEHOLDER;
      img.width = THUMB_W;
      img.height = THUMB_H;
      const label = document.createElement("span");
      label.textContent = name;
      button.append(img, label);
      button.addEventListener("click", () => {
        this.close();
        this.apply(name);
      });
      this.grid.append(button);
      return { img, settings };
    });
    // One thumbnail per animation frame keeps the page responsive while they render.
    const step = (): void => {
      const next = queue.shift();
      if (!next || generation !== this.generation) return;
      next.img.src = this.app.renderThumbnail(next.settings, t, THUMB_W, THUMB_H);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
