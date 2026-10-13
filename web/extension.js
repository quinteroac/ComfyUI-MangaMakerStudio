import { app } from '../../scripts/app.js';
import { Studio } from './studio.js';
import { el, button } from './client.js';

let studio;
function openStudio() {
    if (studio) { studio.dialog.focus(); return; }
    studio = new Studio(); studio.onClose = () => studio = null;
}
app.registerExtension({
    name: 'MangaMaker.Studio',
    commands: [{ id: 'MangaMaker.Open', label: 'Manga Maker Studio', icon: 'pi pi-book', function: openStudio }],
    menuCommands: [{ path: ['Manga Maker'], commands: ['MangaMaker.Open'] }],
    async setup() {
        const style = el('link', { rel: 'stylesheet', href: new URL('./studio.css', import.meta.url).href }); document.head.append(style);
        app.extensionManager.registerSidebarTab({
            id: 'manga-maker-studio', icon: 'pi pi-book', title: 'Manga Maker Studio', tooltip: 'Manga projects', type: 'custom',
            render(container) { container.replaceChildren(el('div', { class: 'mm-sidebar' }, el('h2', { text: 'Manga Maker Studio' }),
                el('p', { text: 'References, panels, and pages in a local workspace.' }), button('Open Manga Maker Studio', openStudio, { class: 'mm-primary' }))); },
        });
    },
});
