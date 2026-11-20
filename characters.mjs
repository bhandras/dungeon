import * as THREE from 'three';

const bevelShape = new THREE.Shape()
  .moveTo(-0.43, -0.43).lineTo(0.43, -0.43).lineTo(0.43, 0.43)
  .lineTo(-0.43, 0.43).closePath();
const bevel = new THREE.ExtrudeGeometry(bevelShape, {
  depth: 0.86, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 1,
  curveSegments: 1, steps: 1,
}).translate(0, 0, -0.43);

function unindex(geometry) {
  const expanded = geometry.toNonIndexed();
  geometry.dispose();
  return expanded;
}

const shapes = {
  bevel,
  facet: new THREE.IcosahedronGeometry(0.5, 1),
  shard: new THREE.OctahedronGeometry(0.5),
  cone: unindex(new THREE.ConeGeometry(0.5, 1, 5)),
  cylinder: unindex(new THREE.CylinderGeometry(0.5, 0.5, 1, 8)),
  taper: unindex(new THREE.CylinderGeometry(0.40, 0.5, 1, 8)),
};

const surfaces = new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.13,
  emissive: 0x35383b, emissiveIntensity: 0.14,
});
const lamps = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const yAxis = new THREE.Vector3(0, 1, 0);

function part(shape, color, size, position, rotation = [0, 0, 0]) {
  return {
    shape, color,
    transform: new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...size),
    ),
  };
}

function limb(shape, color, width, start, end, depth = width) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const direction = b.clone().sub(a);
  return {
    shape, color,
    transform: new THREE.Matrix4().compose(
      a.lerp(b, 0.5),
      new THREE.Quaternion().setFromUnitVectors(yAxis, direction.clone().normalize()),
      new THREE.Vector3(width, direction.length(), depth),
    ),
  };
}

// Bake fixed details into a single mesh per animated part and share it across spawns.
function bake(parent, parts, material = surfaces) {
  const positions = [];
  const colors = [];
  const point = new THREE.Vector3();
  for (const { shape, color, transform } of parts) {
    const source = shapes[shape].attributes.position;
    const tint = new THREE.Color(color);
    for (let i = 0; i < source.count; i += 1) {
      point.fromBufferAttribute(source, i).applyMatrix4(transform);
      positions.push(point.x, point.y, point.z);
      colors.push(tint.r, tint.g, tint.b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = material === surfaces;
  parent.add(mesh);
}

function joint(parent, x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);
  return group;
}

export function createExplorerModel() {
  const root = new THREE.Group();
  const slate = 0x77808c;
  const cloth = 0x34323a;
  const hood = 0xc5a389;
  const rust = 0xc4572c;
  const bronze = 0xba8750;
  const torso = [
    part('taper', cloth, [0.99, 1.07, 0.79], [0, 1.54, 0]),
    part('bevel', slate, [0.94, 0.64, 0.46], [0, 1.82, -0.22], [0.12, 0, 0]),
    part('bevel', 0x635044, [1.05, 0.20, 0.81], [0, 1.16, 0.01]),
    part('bevel', bronze, [0.27, 0.18, 0.12], [0, 1.16, -0.43]),
    part('bevel', 0x514940, [0.76, 0.83, 0.42], [0, 1.76, 0.47]),
    part('facet', hood, [1.04, 1.03, 0.97], [0, 2.68, 0.03]),
    part('bevel', 0x211f25, [0.72, 0.61, 0.39], [0, 2.66, -0.35], [0.12, 0, 0]),
    part('bevel', slate, [0.43, 0.23, 0.22], [0, 2.51, -0.53], [0.24, 0, 0]),
    part('facet', rust, [1.14, 0.39, 0.97], [0, 2.23, -0.02], [-0.14, 0, 0.09]),
    part('shard', 0xf08445, [0.63, 0.26, 0.35], [0.09, 2.19, -0.45], [0, 0, -0.36]),
    part('bevel', cloth, [0.30, 0.31, 1.27], [0.34, 1.84, -0.72], [0.08, 0, 0]),
    part('bevel', bronze, [0.34, 0.21, 0.57], [0.34, 1.85, -0.98], [0.08, 0, 0]),
    part('bevel', slate, [0.20, 0.19, 0.35], [0.34, 1.86, -1.44], [0.08, 0, 0]),
    part('bevel', cloth, [0.16, 0.31, 0.22], [0.34, 1.62, -0.75], [-0.29, 0, 0]),
  ];

  const lights = [
    part('bevel', 0x76ecff, [0.57, 0.13, 0.11], [0, 2.74, -0.56]),
    part('cylinder', 0xffbf63, [0.27, 0.50, 0.27], [-0.40, 1.98, 0.64]),
    part('bevel', 0xffc96d, [0.15, 0.045, 0.21], [0.34, 2.01, -1.04]),
  ];
  for (const y of [1.73, 1.95, 2.20]) {
    torso.push(part('cylinder', bronze, [0.34, 0.065, 0.34], [-0.40, y, 0.64]));
  }
  for (const side of [-1, 1]) {
    torso.push(
      part('bevel', slate, [0.46, 0.38, 0.58], [side * 0.56, 2.04, -0.04], [0.16, 0, side * 0.36]),
      part('bevel', rust, [0.12, 0.055, 0.30], [side * 0.61, 2.22, -0.10], [0, 0.18, side * 0.40]),
      limb('taper', cloth, 0.29, [side * 0.54, 1.93, -0.11], [side * 0.53, 1.59, -0.37]),
      limb('bevel', slate, 0.29, [side * 0.53, 1.59, -0.38], [side === 1 ? 0.36 : 0.14, 1.77, side === 1 ? -0.65 : -0.96]),
      part('cylinder', bronze, [0.22, 0.12, 0.22], [side * 0.23, 2.53, -0.52], [Math.PI / 2, 0, 0]),
      part('bevel', bronze, [0.25, 0.31, 0.25], [side * 0.44, 1.18, 0.27]),
    );
  }
  bake(root, torso);
  bake(root, lights, lamps);

  const legs = [-1, 1].map((side) => {
    const leg = joint(root, side * 0.25, 1.17, 0);
    bake(leg, [
      limb('taper', cloth, 0.39, [0, 0, 0.02], [0, -0.58, -0.06]),
      part('bevel', slate, [0.36, 0.33, 0.22], [0, -0.55, -0.17], [0.16, 0, 0]),
      limb('bevel', 0x545762, 0.31, [0, -0.57, -0.04], [0, -1.0, 0.06]),
      part('bevel', cloth, [0.38, 0.21, 0.55], [0, -1.05, -0.09]),
      part('bevel', slate, [0.35, 0.13, 0.28], [0, -0.99, -0.26]),
    ]);
    return leg;
  });

  const scarf = joint(root, 0.26, 2.24, 0.35);
  bake(scarf, [
    part('shard', rust, [0.54, 1.12, 0.19], [0.04, -0.44, 0.35], [-0.56, -0.05, 0.31]),
    part('shard', 0x9c4327, [0.43, 1.43, 0.15], [0.20, -0.54, 0.48], [-0.70, 0, 0.31]),
  ]);
  return { root, legs, scarf };
}

const palettes = {
  skitter: { shell: 0x474052, edge: 0x71617d, hide: 0x29252d, bone: 0xb29879 },
  stalker: { shell: 0x534752, edge: 0x735d70, hide: 0x342b32, bone: 0xd6c2a1 },
  zigzag: { shell: 0x435d8d, edge: 0xf1a347, hide: 0x272d50, bone: 0xc5a675 },
  brute: { shell: 0x813f37, edge: 0x77707a, hide: 0x462926, bone: 0xca6f40 },
};

function buildCrawler(root, typeKey, eye) {
  const { shell, edge, hide, bone } = palettes[typeKey];
  const skitter = typeKey === 'skitter';
  const brute = typeKey === 'brute';
  const stalker = typeKey === 'stalker';
  const bodyHeight = skitter ? 0.69 : stalker ? 1.25 : 0.92;
  const faceHeight = stalker ? 1.54 : brute ? 0.98 : 0.82;
  const width = brute ? 1.55 : skitter ? 1.23 : 0.91;

  const armor = [
    part('facet', hide, [width, 1.02, 1.48], [0, bodyHeight, 0.15], [0.15, 0, 0]),
    part('facet', stalker ? bone : shell, [brute ? 0.80 : 0.63, 0.53, 0.74], [0, faceHeight, -0.57], [0.30, 0, 0]),
    part('shard', bone, [0.25, 0.44, 0.31], [0, faceHeight - 0.08, -0.88], [0.4, 0, 0]),
  ];
  const dorsalCount = brute ? 5 : 3;
  for (let i = 0; i < dorsalCount; i += 1) {
    const z = -0.27 + i * 0.28;
    armor.push(part('shard', i % 2 ? edge : shell, [width * 0.28, 0.52, 0.51], [0, bodyHeight + 0.54, z], [-0.48, 0, 0]));
    for (const side of [-1, 1]) {
      armor.push(part('facet', i % 2 ? shell : edge, [width * 0.62, 0.25, 0.74],
        [side * width * 0.27, bodyHeight + 0.36 - i * 0.05, z + 0.06], [-0.33, side * 0.25, side * -0.42]));
    }
  }

  const eyes = [];
  for (const side of [-1, 1]) {
    const x = side * (brute ? 0.23 : 0.18);
    eyes.push(part('shard', eye, [0.24, 0.15, 0.23], [x, faceHeight + 0.10, -0.89], [0, 0, side * 0.35]));
    if (brute) {
      armor.push(
        part('facet', edge, [0.63, 0.55, 0.82], [side * 0.61, bodyHeight + 0.23, -0.28], [0.3, 0, side * 0.37]),
        limb('cone', bone, 0.25, [side * 0.35, 1.12, -0.65], [side * 0.53, 1.76, -0.83]),
      );
    }
  }
  bake(root, armor);
  bake(root, eyes, lamps);

  const gait = [joint(root, 0, 0.19, 0), joint(root, 0, 0.19, 0)];
  const legs = [[], []];
  for (const side of [-1, 1]) {
    for (let row = 0; row < (skitter ? 3 : 2); row += 1) {
      const z = -0.31 + row * (skitter ? 0.39 : 0.73);
      const start = [side * width * 0.34, bodyHeight - 0.22, z];
      const elbow = [side * (width * 0.59 + 0.13), bodyHeight - (stalker ? 0.19 : 0.32), z + 0.13];
      const end = [side * (width * 0.64 + 0.18), -0.14, z + (row === 0 ? -0.31 : 0.06)];
      const thickness = brute ? 0.42 : stalker ? 0.25 : 0.19;
      legs[(row + (side === 1 ? 1 : 0)) % 2].push(
        limb('taper', shell, thickness, start, elbow),
        part('facet', edge, [thickness * 1.35, thickness, thickness * 1.23], elbow),
        limb('cone', bone, thickness, elbow, end),
      );
    }
  }
  gait.forEach((group, i) => bake(group, legs[i]));

  const wings = [];
  if (typeKey === 'zigzag') {
    for (const side of [-1, 1]) {
      const wing = joint(root, side * 0.43, 0.91, 0.02);
      bake(wing, [0, 1, 2].flatMap((i) => {
        const z = i * 0.29;
        return [
          limb('cone', shell, 0.32, [0, 0, z], [side * 0.44, 0.62 - i * 0.08, z + 0.60]),
          limb('cone', edge, 0.18, [side * 0.24, 0.36, z + 0.17], [side * 0.57, 0.81 - i * 0.11, z + 0.83]),
        ];
      }));
      wings.push(wing);
    }
  }
  return { segments: [], wings, gait };
}

function buildSerpent(root, huge, eye) {
  const jade = huge ? 0x298779 : 0x497f72;
  const mineral = 0x65bf9f;
  const gold = huge ? 0xd6a15c : 0xb7aa7a;
  const armor = [
    part('facet', jade, [0.98, 0.56, 1.15], [0, 0.76, -0.52], [0.18, 0, 0]),
    part('facet', gold, [0.65, 0.23, 0.77], [0, 0.50, -0.69], [-0.12, 0, 0]),
    part('shard', mineral, [0.49, 0.47, 0.63], [0, 1.05, -0.45], [0.32, 0, 0]),
  ];
  const eyes = [];
  for (const side of [-1, 1]) {
    armor.push(
      limb('cone', gold, 0.16, [side * 0.27, 0.60, -0.89], [side * 0.25, 0.35, -1.0]),
      limb('cone', gold, huge ? 0.31 : 0.19, [side * 0.31, 0.95, -0.53], [side * 0.53, huge ? 1.60 : 1.17, 0.12]),
      part('shard', jade, [0.48, 0.22, 0.61], [side * 0.38, 0.82, -0.19], [0.08, side * 0.4, side * -0.55]),
    );
    eyes.push(part('shard', eye, [0.20, 0.15, 0.25], [side * 0.30, 0.86, -0.92]));
  }
  if (huge) {
    armor.push(limb('cone', gold, 0.24, [0, 1.12, -0.35], [0, 1.71, 0.12]));
    eyes.push(part('shard', eye, [0.20, 0.20, 0.32], [0, 1.15, -0.65]));
  }
  bake(root, armor);
  bake(root, eyes, lamps);

  const segments = [];
  const count = huge ? 13 : 7;
  const spacing = huge ? 0.34 : 0.38;
  for (let i = 0; i < count; i += 1) {
    const taper = 1 - i * (huge ? 0.045 : 0.08);
    const segment = joint(root, 0, 0.36 + Math.max(0, 2 - i) * 0.08, 0.02 + i * spacing);
    segment.scale.setScalar(taper);
    bake(segment, [
      part('facet', gold, [0.73, 0.43, 0.85], [0, -0.08, 0]),
      part('facet', jade, [0.95, 0.47, 0.85], [0, 0, 0]),
      part('shard', i % 2 ? mineral : jade, [0.75, 0.38, 0.79], [0, 0.24, 0.04], [-0.24, 0, 0]),
      part('shard', gold, [0.29, 0.27, 0.68], [-0.37, 0.13, 0.07], [-0.15, -0.33, -0.38]),
      part('shard', gold, [0.29, 0.27, 0.68], [0.37, 0.13, 0.07], [-0.15, 0.33, 0.38]),
    ]);
    segments.push(segment);
  }
  const tail = joint(root, 0, 0.29, count * spacing);
  bake(tail, [limb('cone', jade, huge ? 0.47 : 0.41, [0, 0, -0.31], [0, 0.04, 0.65])]);
  segments.push(tail);
  return { segments, wings: [], gait: [] };
}

const creatureTemplates = new Map();

export function createCreatureModel(typeKey, { scale, eye }) {
  if (!creatureTemplates.has(typeKey)) {
    const root = new THREE.Group();
    const serpent = typeKey === 'serpent' || typeKey === 'viper';
    const parts = serpent ? buildSerpent(root, typeKey === 'serpent', eye) : buildCrawler(root, typeKey, eye);
    const slots = Object.fromEntries(
      Object.entries(parts).map(([name, groups]) => [name, groups.map((group) => root.children.indexOf(group))]),
    );
    root.scale.setScalar(scale);
    // Segment motion is specified in model units so it scales with the rest of the rig.
    creatureTemplates.set(typeKey, { root, slots });
  }

  const template = creatureTemplates.get(typeKey);
  const root = template.root.clone();
  const animatedParts = {};
  for (const [name, indices] of Object.entries(template.slots)) {
    animatedParts[name] = indices.map((index) => root.children[index]);
  }
  return { root, animatedParts };
}
