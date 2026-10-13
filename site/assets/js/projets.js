// Page Projets — accordéon vertical (un seul projet ouvert) et galerie par projet.
// Chaque <section class="proj-sec"> contient l'image principale dans .m-img et,
// dans un <template>, les images supplémentaires de sa galerie.
(() => {
  const sections = Array.from(document.querySelectorAll('.proj-sec'));
  if (!sections.length) return;

  const projets = sections.map((sec) => {
    const img = sec.querySelector('.m-img img');
    const tpl = sec.querySelector('template');
    const extra = tpl ? Array.from(tpl.content.querySelectorAll('img')) : [];
    const images = [img].concat(extra).map((i) => ({ src: i.getAttribute('src'), alt: i.getAttribute('alt') || '' }));
    return {
      sec, img, images,
      prev: sec.querySelector('.m-pv'),
      next: sec.querySelector('.m-nx'),
      count: sec.querySelector('.m-ct'),
      desc: sec.querySelector('.proj-desc'),
      more: sec.querySelector('.proj-more'),
      k: 0,
      open: false,
      preloaded: false
    };
  });

  const show = (p) => {
    const it = p.images[p.k];
    if (p.img.getAttribute('src') !== it.src) {
      p.img.setAttribute('src', it.src);
      p.img.setAttribute('alt', it.alt);
    }
    if (p.count) {
      p.count.textContent = (p.k + 1) + ' / ' + p.images.length;
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = ' — ' + it.alt;
      p.count.appendChild(sr);
    }
  };

  const preload = (p) => {
    if (p.preloaded) return;
    p.preloaded = true;
    p.images.slice(1).forEach((it) => { const i = new Image(); i.src = it.src; });
  };

  const setOpen = (p, open) => {
    p.open = open;
    p.sec.classList.toggle('is-open', open);
    if (p.desc) p.desc.hidden = !open;
    if (p.more) {
      p.more.textContent = open ? 'Réduire −' : 'En savoir plus +';
      p.more.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    const nav = open && p.images.length > 1;
    [p.prev, p.next, p.count].forEach((el) => { if (el) el.hidden = !nav; });
    if (open) preload(p);
    else p.k = 0; // la section quittée revient à son image 1
    show(p);
  };

  const toggle = (p) => {
    const current = projets.find((q) => q.open);
    if (current && current !== p) setOpen(current, false);
    setOpen(p, !p.open);
  };

  projets.forEach((p) => {
    show(p);
    p.sec.addEventListener('click', (e) => {
      if (e.target.closest('.m-pv, .m-nx')) return;
      toggle(p);
    });
    if (p.prev) p.prev.addEventListener('click', (e) => {
      e.stopPropagation();
      p.k = (p.k + p.images.length - 1) % p.images.length;
      show(p);
    });
    if (p.next) p.next.addEventListener('click', (e) => {
      e.stopPropagation();
      p.k = (p.k + 1) % p.images.length;
      show(p);
    });
  });
})();
