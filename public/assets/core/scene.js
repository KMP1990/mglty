/**
 * خلفية التطبيق: شبكة هادئة + هالات ضوئية + مجسمات CSS 3D.
 * تُحقن مرة واحدة من boot.js، وتُخفى تلقائيًا أثناء القراءة (body.is-reading).
 * كلها زخرفية ولا تلتقط أي نقر (pointer-events: none).
 */
export function initScene() {
  if (typeof document === 'undefined' || document.querySelector('.bg-scene')) return;
  const scene = document.createElement('div');
  scene.className = 'bg-scene';
  scene.setAttribute('aria-hidden', 'true');
  scene.innerHTML = `
    <span class="bg-grid"></span>
    <span class="bg-blob b1"></span>
    <span class="bg-blob b2"></span>
    <span class="bg-blob b3"></span>
    <span class="scene-object o1">
      <span class="scene-cube">
        <i></i><i></i><i></i><i></i><i></i><i></i>
      </span>
    </span>
    <span class="scene-object o2"><span class="scene-orb"></span></span>
    <span class="scene-object o3"><span class="scene-ring"></span></span>`;
  document.body.prepend(scene);
}
