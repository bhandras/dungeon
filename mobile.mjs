export function createTouchControls({ isPlaying, onTouch }) {
  const sticks = ['move', 'aim'].map((name) => {
    const element = document.getElementById(name + 'Stick');
    const thumb = element.querySelector('.stick-thumb');
    const stick = { x: 0, y: 0, pointer: null, reset };

    function reset() {
      const pointer = stick.pointer;
      stick.pointer = null;
      stick.x = 0;
      stick.y = 0;
      thumb.style.transform = '';
      if (pointer !== null && element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
    }

    function track(event) {
      const bounds = element.getBoundingClientRect();
      const radius = bounds.width * 0.36;
      const x = (event.clientX - bounds.left - bounds.width / 2) / radius;
      const y = (event.clientY - bounds.top - bounds.height / 2) / radius;
      const distance = Math.hypot(x, y);
      const magnitude = Math.min(1, Math.max(0, (distance - 0.18) / 0.82));
      stick.x = distance ? x / distance * magnitude : 0;
      stick.y = distance ? y / distance * magnitude : 0;
      thumb.style.transform = 'translate(' + stick.x * radius + 'px, ' + stick.y * radius + 'px)';
    }

    element.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' || stick.pointer !== null || !isPlaying()) return;
      event.preventDefault();
      onTouch();
      stick.pointer = event.pointerId;
      element.setPointerCapture(event.pointerId);
      track(event);
    });
    element.addEventListener('pointermove', (event) => {
      if (event.pointerId === stick.pointer) track(event);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      element.addEventListener(type, (event) => {
        if (event.pointerId === stick.pointer) reset();
      });
    }
    return stick;
  });
  return { move: sticks[0], aim: sticks[1], reset: () => sticks.forEach((stick) => stick.reset()) };
}
