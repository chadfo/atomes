// <atom-logo> — logo animé : nuage de particules orbitant autour d'un noyau
(function () {
  if (customElements.get('atom-logo')) return;

  class AtomLogo extends HTMLElement {
    connectedCallback() {
      if (!this._init) {
        this._init = true;
        if (!this.style.display) this.style.display = 'block';
        const c = document.createElement('canvas');
        c.style.cssText = 'width:100%;height:100%;display:block';
        c.setAttribute('aria-hidden', 'true');
        this.appendChild(c);
        this._c = c;
        const N = 240;
        this._p = [];
        for (let i = 0; i < N; i++) {
          const ring = Math.random();
          const base = ring < 0.28 ? 0.4 : ring < 0.62 ? 0.65 : 0.9;
          this._p.push({
            a: Math.random() * Math.PI * 2,
            va: (0.2 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1) * 0.012,
            r: base + (Math.random() - 0.5) * 0.24,
            j: Math.random() * Math.PI * 2,
            vj: 0.02 + Math.random() * 0.035,
            s: 0.4 + Math.random() * 0.9,
            o: 0.2 + Math.random() * 0.6
          });
        }
      }
      this._start();
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); this._raf = 0; }
    _start() {
      if (this._raf) return;
      const tick = () => { this._raf = requestAnimationFrame(tick); this._draw(); };
      this._raf = requestAnimationFrame(tick);
    }
    _draw() {
      const c = this._c, dpr = window.devicePixelRatio || 1;
      const w = this.clientWidth || 26, h = this.clientHeight || 26;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      const cx = c.width / 2, cy = c.height / 2, R = Math.min(cx, cy) * 0.98;
      const dot = Math.max(1, dpr * 0.8);
      ctx.fillStyle = '#ece7de';
      for (const p of this._p) {
        p.a += p.va; p.j += p.vj;
        const r = (p.r + Math.sin(p.j) * 0.05) * R;
        ctx.globalAlpha = p.o * (0.55 + 0.45 * Math.sin(p.j * 1.7));
        ctx.fillRect(cx + Math.cos(p.a) * r, cy + Math.sin(p.a) * r, p.s * dot, p.s * dot);
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = '#fffdf8';
      ctx.fill();
      ctx.fillStyle = '#ece7de';
    }
  }
  customElements.define('atom-logo', AtomLogo);
})();
