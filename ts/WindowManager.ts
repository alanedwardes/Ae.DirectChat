interface Position {
    x: number;
    y: number;
}

const storageKey: string = "ae.directchat.windows";

export class WindowManager {
    private readonly desktop: MediaQueryList = window.matchMedia('(pointer: fine) and (min-width: 641px)');
    private readonly windows: Map<string, HTMLElement> = new Map();
    private openOrder: string[] = [];
    private positions: { [id: string]: Position } = {};
    private topZ: number = 1;

    public OnOpened: (id: string) => void;

    public constructor() {
        this.positions = WindowManager.loadPositions();

        document.querySelectorAll<HTMLElement>('#panels > .window').forEach(element => {
            this.windows.set(element.id, element);
            element.querySelector('.windowHeader > .closeButton').addEventListener('click', () => this.close(element.id));
            element.addEventListener('pointerdown', () => this.bringToFront(element.id));
            this.makeDraggable(element);
        });

        document.querySelectorAll<HTMLButtonElement>('.controls button[data-panel]').forEach(button => {
            button.setAttribute('aria-pressed', 'false');
            button.addEventListener('click', () => this.toggle(button.dataset.panel));
        });

        window.addEventListener('keydown', event => {
            if (event.key === 'Escape' && this.openOrder.length > 0) {
                this.close(this.openOrder[this.openOrder.length - 1]);
            }
        });

        window.addEventListener('resize', () => this.windows.forEach((_, id) => this.applyPosition(id)));

        const onLayoutChange = () => {
            if (!this.desktop.matches) {
                this.openOrder.slice(0, -1).forEach(id => this.close(id));
            }
        };
        if (typeof this.desktop.addEventListener === 'function') {
            this.desktop.addEventListener('change', onLayoutChange);
        } else {
            this.desktop.addListener(onLayoutChange);
        }
    }

    public isOpen(id: string): boolean {
        return this.openOrder.includes(id);
    }

    public toggle(id: string): void {
        if (this.isOpen(id)) {
            this.close(id);
        } else {
            this.open(id);
        }
    }

    public open(id: string): void {
        const element = this.windows.get(id);
        if (element == null) {
            return;
        }

        if (!this.desktop.matches) {
            this.openOrder.filter(other => other !== id).forEach(other => this.close(other));
        }

        element.classList.remove('hidden');
        this.applyPosition(id);
        this.bringToFront(id);
        this.update();

        if (this.OnOpened != null) {
            this.OnOpened(id);
        }
    }

    public close(id: string): void {
        this.windows.get(id)?.classList.add('hidden');
        this.openOrder = this.openOrder.filter(other => other !== id);
        this.update();
    }

    private bringToFront(id: string): void {
        const element = this.windows.get(id);
        if (element == null || element.classList.contains('hidden')) {
            return;
        }
        this.openOrder = [...this.openOrder.filter(other => other !== id), id];
        element.style.zIndex = String(++this.topZ);
    }

    private update(): void {
        document.querySelectorAll<HTMLButtonElement>('.controls button[data-panel]').forEach(button =>
            button.setAttribute('aria-pressed', String(this.isOpen(button.dataset.panel))));
        document.body.classList.toggle('panelOpen', this.openOrder.length > 0);
    }

    private makeDraggable(element: HTMLElement): void {
        const header = element.querySelector<HTMLElement>('.windowHeader');
        let offsetX = 0;
        let offsetY = 0;
        let pointerId: number = null;

        header.addEventListener('pointerdown', event => {
            if (!this.desktop.matches || event.button !== 0 || (event.target as Element).closest('button') != null) {
                return;
            }
            const rect = element.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            pointerId = event.pointerId;
            header.setPointerCapture(pointerId);
            element.classList.add('dragging');
            event.preventDefault();
        });

        header.addEventListener('pointermove', event => {
            if (event.pointerId !== pointerId) {
                return;
            }
            this.positions[element.id] = { x: event.clientX - offsetX, y: event.clientY - offsetY };
            this.applyPosition(element.id);
        });

        const endDrag = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) {
                return;
            }
            pointerId = null;
            element.classList.remove('dragging');
            this.savePositions();
        };
        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);

        header.addEventListener('dblclick', event => {
            if ((event.target as Element).closest('button') != null) {
                return;
            }
            delete this.positions[element.id];
            this.applyPosition(element.id);
            this.savePositions();
        });
    }

    private applyPosition(id: string): void {
        const element = this.windows.get(id);
        const position = this.positions[id];
        if (element == null) {
            return;
        }

        if (position == null) {
            element.classList.remove('placed');
            element.style.removeProperty('--x');
            element.style.removeProperty('--y');
            return;
        }

        element.classList.add('placed');
        const width = element.offsetWidth;
        const headerHeight = element.querySelector<HTMLElement>('.windowHeader').offsetHeight || 48;
        const x = Math.min(Math.max(0, position.x), Math.max(0, window.innerWidth - width));
        const y = Math.min(Math.max(0, position.y), Math.max(0, window.innerHeight - headerHeight));
        element.style.setProperty('--x', x + 'px');
        element.style.setProperty('--y', y + 'px');
    }

    private static loadPositions(): { [id: string]: Position } {
        try {
            const stored = JSON.parse(window.localStorage.getItem(storageKey));
            if (stored == null || typeof stored !== 'object' || Array.isArray(stored)) {
                return {};
            }
            const positions: { [id: string]: Position } = {};
            for (const id of Object.keys(stored)) {
                const { x, y } = stored[id] ?? {};
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    positions[id] = { x, y };
                }
            }
            return positions;
        } catch {
            return {};
        }
    }

    private savePositions(): void {
        try {
            if (Object.keys(this.positions).length === 0) {
                window.localStorage.removeItem(storageKey);
            } else {
                window.localStorage.setItem(storageKey, JSON.stringify(this.positions));
            }
        } catch {
        }
    }
}
