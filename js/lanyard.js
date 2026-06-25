// Lanyard badge — vanilla Three.js + Rapier physics port of the React Bits
// <Lanyard /> component. This site has no React/Vite/bundler, so this is a
// from-scratch reimplementation of the same idea (rope-jointed rigid bodies
// + a draggable card) using plain ES modules loaded straight from a CDN.
//
// If anything fails to load or init (offline, WebGL unavailable, reduced
// motion preference) we leave the static CSS fallback badge in the markup
// untouched and simply never mount the canvas — the page never shows a
// broken/blank widget.

// ---------------------------------------------------------------------
// Fallback-badge pendulum — runs independently of the Three.js/Rapier
// canvas below. Gives the static CSS badge a believable idle sway plus
// cursor-drag-with-momentum, so it never reads as a frozen placeholder
// even while (or if) the full 3D version fails to mount. The 3D init
// below hides #lanyard-fallback (display:none) the instant it succeeds,
// and this loop checks that on every frame, so the two never run visibly
// at once.
(function initFallbackPendulum() {
  var fallback = document.getElementById('lanyard-fallback');
  var card = fallback && fallback.querySelector('.lf-card');
  if (!fallback || !card) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  card.style.animation = 'none'; // hand rotation over to this loop instead of the CSS keyframe
  card.style.cursor = 'grab';
  card.style.touchAction = 'none';
  card.style.userSelect = 'none';

  var angle = -3 + Math.random() * 6; // deg
  var angVel = 0;
  var dragging = false;
  var dragStartX = 0, dragStartAngle = 0;
  var startTime = performance.now();
  var lastTime = startTime;

  function idleTarget(now) {
    // slow ambient swing so the card never fully settles when left alone
    return Math.sin((now - startTime) / 1400) * 3;
  }

  function onPointerDown(e) {
    dragging = true;
    angVel = 0;
    dragStartX = e.clientX;
    dragStartAngle = angle;
    card.style.cursor = 'grabbing';
    try { card.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onPointerMove(e) {
    if (!dragging) return;
    var next = Math.max(-50, Math.min(50, dragStartAngle + (e.clientX - dragStartX) * 0.35));
    angVel = next - angle;
    angle = next;
  }
  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    card.style.cursor = 'grab';
    try { card.releasePointerCapture(e.pointerId); } catch (err) {}
  }
  card.addEventListener('pointerdown', onPointerDown);
  card.addEventListener('pointermove', onPointerMove);
  card.addEventListener('pointerup', onPointerUp);
  card.addEventListener('pointercancel', onPointerUp);

  function frame(now) {
    requestAnimationFrame(frame);
    if (fallback.style.display === 'none') return; // real 3D badge took over
    var dt = Math.min((now - lastTime) / 16.6, 2);
    lastTime = now;
    if (!dragging) {
      var target = idleTarget(now);
      var accel = (target - angle) * 0.02 - angVel * 0.12;
      angVel += accel * dt;
      angle += angVel * dt;
    }
    card.style.transform = 'rotate(' + angle.toFixed(2) + 'deg)';
  }
  requestAnimationFrame(frame);
})();

(async function initLanyard() {
  var mount = document.getElementById('lanyard-mount');
  var fallback = document.getElementById('lanyard-fallback');
  if (!mount) return;
  var section = mount.closest('.lanyard-section') || mount;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.WebGLRenderingContext) return;

  try {
    var THREE = await import('three');
    var GLTFLoaderMod = await import('three/addons/loaders/GLTFLoader.js');
    var GLTFLoader = GLTFLoaderMod.GLTFLoader;
    var RAPIER = (await import('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.12.0/+esm')).default;
    await RAPIER.init();

    // ---------- real card.glb model + lanyard.png as the card-face logo ----------
    // card.glb is the original React Bits asset. lanyard.png is Kate's own
    // logo — but the card's UV mapping covers the full face, so dropping her
    // (near edge-to-edge) artwork straight in made it look cropped/blown up.
    // card-face.png is a pre-composited 1024x1024 canvas (same square aspect
    // as the original baked-in texture) with her logo centered and padded,
    // so it sits on the card the way the original artwork did.
    var cardGLBUrl = new URL('./card.glb', import.meta.url).href;
    var logoPngUrl = new URL('./card-face.png', import.meta.url).href;
    var bandPngUrl = new URL('./band-texture.png', import.meta.url).href;

    var gltf = await new GLTFLoader().loadAsync(cardGLBUrl);
    var nodes = {};
    var materials = {};
    gltf.scene.traverse(function (o) {
      if (o.isMesh) {
        nodes[o.name] = o;
        if (o.material && o.material.name) materials[o.material.name] = o.material;
      }
    });

    var logoTex = await new THREE.TextureLoader().loadAsync(logoPngUrl);
    logoTex.colorSpace = THREE.SRGBColorSpace;
    // card.glb's UVs follow the glTF convention (flipY:false) since they
    // were authored for GLTFLoader's own textures. A plain TextureLoader
    // defaults to flipY:true, which sampled the wrong strip of the image —
    // this is what was showing only a tiny corner fragment of the logo.
    logoTex.flipY = false;

    var bandTex = await new THREE.TextureLoader().loadAsync(bandPngUrl);
    // band-texture.png is wide (1025x250) — its long axis is meant to repeat
    // along the cord's LENGTH, its short axis is the cord's WIDTH (no
    // tiling needed there). The ribbon UVs below already do the length-wise
    // tiling by scaling u directly, so the texture's own .repeat stays 1:1
    // and only wrapS needs RepeatWrapping (for u going past 1 as it tiles).
    bandTex.wrapS = THREE.RepeatWrapping;
    bandTex.wrapT = THREE.ClampToEdgeWrapping;
    bandTex.colorSpace = THREE.SRGBColorSpace;

    // ---------- scene ----------
    // Badge is shown ~2x larger, pinned to the top-right corner on desktop;
    // on small screens it drops back to the original in-flow size (CSS
    // shrinks the mount box there too — see .lanyard-section media query).
    // visualScale controls how much of the camera's frustum the card/cord
    // fill — it's independent from how big the canvas itself is on the
    // page. The container (.lanyard-section, sized in CSS) is what makes
    // the whole badge bigger on the page; bumping visualScale on top of
    // that without also pulling the camera back made the card outgrow the
    // frustum and get clipped at the edges. Keep this at its original,
    // known-good framing and let the (now larger) CSS box do the scaling.
    var isCompact = window.matchMedia && window.matchMedia('(max-width:680px)').matches;
    // The mount went from a small 60vh CSS box to the full viewport (100vh)
    // so the badge can be dragged into any corner. Pulling the camera back
    // (bigger cameraZ) to compensate for the taller canvas is NOT enough on
    // its own: moving just the camera away from a scene that stays put
    // changes its viewing ANGLE to anything not exactly at the look-at
    // point, which silently pulled the fixed anchor (well above the card)
    // down into frame — leaving a visible gap of plain background between
    // the navbar and the cord instead of the cord disappearing seamlessly
    // behind it like before.
    // The fix that's actually exact: scale the ENTIRE scene — camera
    // position, the rope/card's world-space layout, and the visual sizes —
    // by the same constant WORLD_SCALE (1 / 0.6, matching the canvas height
    // going from 0.6×innerHeight to 1×innerHeight). Scaling literally
    // everything by one factor around the origin leaves every projected
    // screen position identical to the old small-box framing (it's a pure
    // zoom), while the taller canvas naturally renders that unchanged
    // framing at proportionally bigger pixel size — exactly matching the
    // box growing from 60vh to 100vh. isCompact keeps the old in-flow box,
    // so it keeps WORLD_SCALE at 1 (untouched).
    var WORLD_SCALE = isCompact ? 1 : 1 / 0.6;
    var visualScale = (isCompact ? 2.25 : 3.1) * WORLD_SCALE;
    var bandRadius = (isCompact ? 0.045 : 0.075) * WORLD_SCALE;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(25, 1, 0.1, 100);
    var cameraZ = (isCompact ? 20 : 21) * WORLD_SCALE;
    var LOOKAT_Y = -1 * WORLD_SCALE;
    var ANCHOR_WORLD_X = 0;
    camera.position.set(0, 1 * WORLD_SCALE, cameraZ);
    camera.lookAt(0, LOOKAT_Y, 0);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    var key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-3, 5, 6); scene.add(key);
    var rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(4, -2, 5); scene.add(rim);

    // Real card geometry from card.glb — same node names as the original
    // React component (nodes.card / nodes.clip / nodes.clamp, materials.base
    // for the printed face, materials.metal for the clip/clamp hardware).
    // Printed plastic ID card, not brushed metal — high metalness was eating
    // the logo's colour (no env map to reflect, so metallic = goes dark).
    // The original GLB material used metalness 0.3 / roughness 0; this stays
    // a bit more matte to read as a printed card rather than a mirror.
    var cardFaceMat = new THREE.MeshPhysicalMaterial({
      map: logoTex,
      clearcoat: 0.4, clearcoatRoughness: 0.25, roughness: 0.55, metalness: 0.1
    });
    var cardVisual = new THREE.Group();
    cardVisual.scale.set(visualScale, visualScale, visualScale);
    // The card's clip hole must always land exactly on (0, 1.5, 0) in
    // cardGroup-local space — that's the spherical-joint anchor point where
    // the band's last segment (j3) actually terminates. At scale 2.25 the
    // hand-tuned offset (0,-1.2,-0.05) made that line up; scaling the visual
    // group without recomputing the offset moves the clip away from the
    // band end (this is what caused the cord to attach to the wrong spot).
    // Solve backwards from the known-good scale=2.25 calibration so any
    // scale keeps the clip pinned to the joint anchor.
    var clipLocal = { y: 1.2, z: 0.05 / 2.25 };
    var JOINT_Y = 1.5 * WORLD_SCALE; // must match the spherical joint anchor below
    cardVisual.position.set(0, JOINT_Y - visualScale * clipLocal.y, -visualScale * clipLocal.z);
    if (nodes.card) cardVisual.add(new THREE.Mesh(nodes.card.geometry, cardFaceMat));
    if (nodes.clip && materials.metal) {
      var clipMat = materials.metal.clone();
      clipMat.roughness = 0.3;
      cardVisual.add(new THREE.Mesh(nodes.clip.geometry, clipMat));
    }
    if (nodes.clamp && materials.metal) {
      cardVisual.add(new THREE.Mesh(nodes.clamp.geometry, materials.metal));
    }

    var cardGroup = new THREE.Group();
    cardGroup.add(cardVisual);
    scene.add(cardGroup);

    var bandMat = new THREE.MeshStandardMaterial({
      map: bandTex, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide
    });
    var bandMesh = null;
    // NOTE: this used to build a THREE.TubeGeometry around the curve each
    // frame. TubeGeometry orients its circular cross-section using
    // auto-computed Frenet frames, which are numerically unstable for a
    // curve that hangs almost perfectly vertical (exactly our cord) — the
    // frame can flip/twist slightly between frames even when the curve
    // barely moves, which reads as the texture "blinking". A flat ribbon
    // strip whose side vector is derived from a FIXED world axis instead of
    // the curve's own (unstable) frame has no such flip, so we build that
    // manually here.
    // The camera looks down the Z axis, and the cord hangs roughly along Y.
    // For the ribbon to present its flat, textured face to the camera (not
    // its paper-thin edge), its width must extend along X with its normal
    // facing Z — so the side vector is tangent × Z (not tangent × X, which
    // was the original mistake: that made the ribbon's width run front-to-
    // back in depth, i.e. edge-on to the camera, looking ghostly/"see-through").
    var bandSideRef = new THREE.Vector3(0, 0, 1);
    var bandSideRefAlt = new THREE.Vector3(1, 0, 0);
    function updateBand(points) {
      var curve = new THREE.CatmullRomCurve3(points);
      curve.curveType = 'chordal';
      var segments = 24;
      var positions = new Float32Array((segments + 1) * 2 * 3);
      var uvs = new Float32Array((segments + 1) * 2 * 2);
      var indices = [];
      for (var i = 0; i <= segments; i++) {
        var t = i / segments;
        var pt = curve.getPointAt(t);
        var tangent = curve.getTangentAt(t).normalize();
        var side = new THREE.Vector3().crossVectors(tangent, bandSideRef);
        if (side.lengthSq() < 1e-4) side.crossVectors(tangent, bandSideRefAlt);
        side.normalize().multiplyScalar(bandRadius);
        var vi = i * 2 * 3;
        positions[vi] = pt.x + side.x; positions[vi + 1] = pt.y + side.y; positions[vi + 2] = pt.z + side.z;
        positions[vi + 3] = pt.x - side.x; positions[vi + 4] = pt.y - side.y; positions[vi + 5] = pt.z - side.z;
        var ui = i * 2 * 2;
        // u runs along the cord's LENGTH (so the texture's wide axis tiles
        // along the strap, matching how it was drawn — see note above the
        // texture loader). v is just 0/1 across the cord's narrow width.
        var u = t * 6;
        uvs[ui] = u; uvs[ui + 1] = 0;
        uvs[ui + 2] = u; uvs[ui + 3] = 1;
        if (i < segments) {
          var a = i * 2, b = a + 1, c = a + 2, d = a + 3;
          indices.push(a, c, b, b, c, d);
        }
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      if (bandMesh) { bandMesh.geometry.dispose(); bandMesh.geometry = geo; }
      else { bandMesh = new THREE.Mesh(geo, bandMat); scene.add(bandMesh); }
    }

    // ---------- physics ----------
    // Gravity is scaled by WORLD_SCALE too: enlarging every distance in the
    // scene without also enlarging the force pulling on it would make the
    // badge fall/swing in slow motion relative to before — scaling both
    // together keeps the exact same timing/feel as the old small-box setup.
    var world = new RAPIER.World({ x: 0, y: -40 * WORLD_SCALE, z: 0 });
    world.timestep = 1 / 60;
    var GROUP_Y = 4 * WORLD_SCALE;
    var segProps = { linearDamping: 4, angularDamping: 4 };

    function makeSegment(y) {
      var body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(0, y, 0)
          // canSleep:false — the user wants the badge to never go fully
          // still. Rapier puts slow-moving bodies to sleep (freezing them)
          // by default; disabling that keeps physics live so the small idle
          // sway force below (see animate()) always has something to act on.
          .setCanSleep(false)
          .setLinearDamping(segProps.linearDamping)
          .setAngularDamping(segProps.angularDamping)
      );
      world.createCollider(RAPIER.ColliderDesc.ball(0.1 * WORLD_SCALE), body);
      return body;
    }

    // Segments start bunched up just under the fixed anchor (not laid out
    // flat in a line on x, like the original React Bits demo, and not
    // already at full hanging length either) — this gives the nice "drop
    // in" entrance the badge needs on page load (gravity pulls it straight
    // DOWN into its resting length, with a little settle/bounce at the
    // end), without the old version's problem: laying the chain out flat on
    // x made it swing sideways across the screen as it fell, which on a
    // fixed, always-visible badge read as the cord flailing wildly. Falling
    // straight down stays visually contained and still looks alive.
    var fixedBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, GROUP_Y, 0));
    var j1 = makeSegment(GROUP_Y - 0.1 * WORLD_SCALE);
    var j2 = makeSegment(GROUP_Y - 0.2 * WORLD_SCALE);
    var j3 = makeSegment(GROUP_Y - 0.3 * WORLD_SCALE);
    var cardBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, GROUP_Y - 0.4 * WORLD_SCALE, 0)
        .setCanSleep(true)
        .setLinearDamping(segProps.linearDamping)
        .setAngularDamping(segProps.angularDamping)
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.8 * WORLD_SCALE, 1.125 * WORLD_SCALE, 0.01 * WORLD_SCALE), cardBody);

    var zero = { x: 0, y: 0, z: 0 };
    world.createImpulseJoint(RAPIER.JointData.rope(1 * WORLD_SCALE, zero, zero), fixedBody, j1, true);
    world.createImpulseJoint(RAPIER.JointData.rope(1 * WORLD_SCALE, zero, zero), j1, j2, true);
    world.createImpulseJoint(RAPIER.JointData.rope(1 * WORLD_SCALE, zero, zero), j2, j3, true);
    world.createImpulseJoint(RAPIER.JointData.spherical(zero, { x: 0, y: JOINT_Y, z: 0 }), j3, cardBody, true);

    function wake(body) { if (body && typeof body.wakeUp === 'function') body.wakeUp(); }

    // ---------- drag interaction ----------
    // Real physics drag: grabbing the card switches cardBody to a kinematic
    // body that follows the cursor in world space, dragging the rope joints
    // along with it (visibly stretching the cord). Releasing hands it back
    // to the dynamic simulation, so gravity + the rope joints snap it back
    // with genuine elastic momentum — that's the "ризинка" effect — rather
    // than a CSS easing curve faking it.
    var raycaster = new THREE.Raycaster();
    var dragging = false;
    var dragOffset = new THREE.Vector3();
    var hovering = false;

    function ndcFromEvent(e) {
      var rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1)
      );
    }
    function pointerWorldPoint(ndc) {
      var vec = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera);
      var dir = vec.clone().sub(camera.position).normalize();
      return vec.add(dir.multiplyScalar(camera.position.length()));
    }
    function hitsCard(ndc) {
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObject(cardVisual, true).length > 0;
    }

    function onPointerMove(e) {
      var ndc = ndcFromEvent(e);
      if (dragging) {
        e.preventDefault();
        var p = pointerWorldPoint(ndc);
        cardBody.setNextKinematicTranslation({ x: p.x - dragOffset.x, y: p.y - dragOffset.y, z: p.z - dragOffset.z });
        return;
      }
      var hit = hitsCard(ndc);
      if (hit !== hovering) {
        hovering = hit;
        document.body.style.cursor = hovering ? 'grab' : '';
      }
    }
    var suppressNextClick = false;
    function onPointerDown(e) {
      var ndc = ndcFromEvent(e);
      if (!hitsCard(ndc)) return;
      // The card sits over real page content (links, etc). Stop the event
      // from doing anything else — the user is grabbing the badge, not
      // whatever's underneath it.
      e.preventDefault();
      e.stopPropagation();
      suppressNextClick = true;
      dragging = true;
      document.body.style.cursor = 'grabbing';
      var p = pointerWorldPoint(ndc);
      var t = cardBody.translation();
      dragOffset.set(p.x - t.x, p.y - t.y, p.z - t.z);
      [fixedBody, j1, j2, j3, cardBody].forEach(wake);
      cardBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
    function onPointerUp(e) {
      if (!dragging) return;
      e.preventDefault();
      dragging = false;
      document.body.style.cursor = hovering ? 'grab' : '';
      cardBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      wake(cardBody);
    }
    // capture:true so we get first dibs, ahead of any link/button under the
    // badge — that's what lets us preventDefault its click before it fires.
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', onPointerUp, { capture: true });
    window.addEventListener('click', function (e) {
      if (suppressNextClick) { suppressNextClick = false; e.preventDefault(); e.stopPropagation(); }
    }, { capture: true });

    // ---------- mount + resize ----------
    fallback.style.display = 'none';
    mount.appendChild(renderer.domElement);

    function resize() {
      var w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      var verticalHalfExtent = cameraZ * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      var horizontalHalfExtent = verticalHalfExtent * camera.aspect;
      var lookAtX;
      if (isCompact) {
        // Mobile: the mount is still its own small in-flow box (CSS keeps
        // it non-fullscreen here), so the badge just sits centered in it —
        // no horizontal shift needed, same as before.
        lookAtX = ANCHOR_WORLD_X;
      } else {
        // Desktop: the mount is now the full viewport, whose aspect ratio
        // swings a lot more than the old small CSS box's did. Re-derive,
        // from the CURRENT window size, the exact horizontal pixel spot the
        // badge used to sit at back when it lived in that box
        // (position:fixed;top:0;right:40px;height:60vh;aspect-ratio:680/1120;
        // centered inside it), then aim the camera so the anchor point lands
        // there. A fixed screen-fraction guess doesn't reproduce this — that
        // old box's position was a fixed PIXEL margin from the right edge,
        // not a fixed fraction of window width, so the two diverge badly at
        // narrower window widths. Recomputing it from real pixels keeps the
        // resting spot accurate at any window size.
        // Use the mount's own box (w/h, already measured above) rather than
        // window.innerWidth/innerHeight: the mount can be narrower than the
        // viewport (e.g. while centered under a max-width cap), and basing
        // this on the window instead of the actual render box is what caused
        // the badge to aim itself off-canvas at certain widths.
        var oldBoxHeight = 0.6 * h;
        var oldBoxWidth = oldBoxHeight * (680 / 1120);
        var oldBoxRightEdge = w - 40;
        var targetPx = oldBoxRightEdge - oldBoxWidth / 2;
        var targetNdcX = (targetPx / w) * 2 - 1;
        lookAtX = ANCHOR_WORLD_X - targetNdcX * horizontalHalfExtent;
      }
      camera.position.x = lookAtX;
      camera.lookAt(lookAtX, LOOKAT_Y, 0);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    resize();
    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(mount);
    } else {
      window.addEventListener('resize', resize);
    }

    // ---------- pause when off-screen ----------
    var running = true;
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        running = entries[0] && entries[0].isIntersecting;
      }, { threshold: 0.01 }).observe(section);
    }

    // ---------- render loop ----------
    var WORLD_UP = new THREE.Vector3(0, 1, 0);
    var minSpeed = 0, maxSpeed = 50;
    var j1Lerp = null, j2Lerp = null;
    var last = performance.now();

    function lerpedPos(body, prevVec) {
      var t = body.translation();
      var current = new THREE.Vector3(t.x, t.y, t.z);
      if (!prevVec) return current;
      var dist = prevVec.distanceTo(current);
      var clamped = Math.max(0.1 * WORLD_SCALE, Math.min(1 * WORLD_SCALE, dist));
      var delta = Math.min((performance.now() - last) / 1000, 0.05);
      prevVec.lerp(current, delta * (minSpeed + clamped * (maxSpeed - minSpeed)));
      return prevVec;
    }

    var rafId = null;
    function animate() {
      rafId = requestAnimationFrame(animate);
      if (!running) return;
      try {
        renderFrame();
      } catch (err) {
        // A failure mid-animation (as opposed to during setup, which the
        // outer try/catch already handles) used to leave the page with
        // neither the canvas nor the static fallback visible — the canvas
        // had already replaced the fallback, then silently stopped
        // rendering on an uncaught error inside a requestAnimationFrame
        // callback. Recover by tearing the canvas down and bringing the
        // static badge back so the page never ends up with nothing shown.
        console.warn('Lanyard: animation failed, reverting to static badge —', err);
        if (rafId) cancelAnimationFrame(rafId);
        if (renderer && renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        if (fallback) fallback.style.display = '';
      }
    }
    function renderFrame() {

      // ---------- idle life: small perpetual sway + a moving glint ----------
      // Without this, damping eventually settles the card dead-still. A
      // tiny, slowly-varying force keeps it perpetually (gently) swaying —
      // never violent, never fully at rest. Several mismatched sine
      // frequencies avoid an obvious repeating "metronome" loop.
      var idleT = performance.now() * 0.001;
      if (!dragging) {
        // No more linear force at all — that was making the whole card swing
        // sideways off its resting straight-down hang, which read as leaning
        // rather than living. Only a small Y-axis torque remains: the card
        // spins gently in place on the cord without drifting away from
        // vertical.
        cardBody.addTorque({
          x: 0,
          y: Math.sin(idleT * 0.22) * 0.00022,
          z: 0
        }, true);
      }
      // The "блік" — a highlight that drifts slowly across the card's
      // clearcoat instead of sitting static, by orbiting the key light a
      // little. Combined with the card's own gentle sway this reads as a
      // soft, ever-shifting glint rather than a fixed shine spot.
      key.position.set(
        -3 + Math.sin(idleT * 0.18) * 1.6,
        5 + Math.cos(idleT * 0.14) * 0.9,
        6 + Math.sin(idleT * 0.11) * 1
      );

      world.step();

      var t3 = j3.translation();
      j1Lerp = lerpedPos(j1, j1Lerp);
      j2Lerp = lerpedPos(j2, j2Lerp);
      var tf = fixedBody.translation();

      updateBand([
        new THREE.Vector3(t3.x, t3.y, t3.z),
        j2Lerp.clone(),
        j1Lerp.clone(),
        new THREE.Vector3(tf.x, tf.y, tf.z)
      ]);

      var ct = cardBody.translation();
      var cq = cardBody.rotation();
      cardGroup.position.set(ct.x, ct.y, ct.z);
      cardGroup.quaternion.set(cq.x, cq.y, cq.z, cq.w);

      // Self-righting so the card settles facing forward AND level.
      // The previous attempt corrected pitch/roll using raw Euler angles
      // with a strong multiplier — Euler extraction has discontinuities
      // (gimbal lock / angle wraparound), and a strong correction driven by
      // one of those spikes was almost certainly what flung the whole rig
      // off-position. This version corrects pitch/roll a different way:
      // it only realigns the card's own "up" axis with world-up, via a
      // cross product (axis-angle), which is bounded and has no
      // discontinuities — and rotating around its own up axis (yaw, our
      // idle spin) never changes that axis, so this can't fight the spin.
      var qNow = new THREE.Quaternion(cq.x, cq.y, cq.z, cq.w);
      var localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qNow);
      var tiltAngle = localUp.angleTo(WORLD_UP);
      var correctX = 0, correctZ = 0;
      if (tiltAngle > 1e-4) {
        // cross(localUp, WORLD_UP) has no Y component by construction, so
        // this only ever touches pitch/roll, never yaw.
        correctX = -localUp.z * tiltAngle * 1.0;
        correctZ = localUp.x * tiltAngle * 1.0;
      }
      var euler = new THREE.Euler().setFromQuaternion(qNow, 'YXZ');
      var av = cardBody.angvel();
      cardBody.setAngvel({
        x: av.x + correctX,
        y: av.y - euler.y * 0.25,
        z: av.z + correctZ
      }, true);

      last = performance.now();
      renderer.render(scene, camera);
    }
    animate();
  } catch (err) {
    // Network/WebGL/WASM failure of any kind — keep the static fallback
    // badge visible and fail quietly rather than show a broken canvas.
    console.warn('Lanyard: falling back to static badge —', err);
  }
})();
