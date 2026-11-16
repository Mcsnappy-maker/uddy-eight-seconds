import {
  Color3,
  DynamicTexture,
  PBRMaterial,
  Scene,
  Texture,
} from '@babylonjs/core';
import { UDDINGSTON_COLOURS } from '../rules/RulesConfig';

export interface MaterialPalette {
  turfPlay: PBRMaterial;
  turfRunoff: PBRMaterial;
  pitchLine: PBRMaterial;
  goalFrameWhite: PBRMaterial;
  backboardBlueGold: PBRMaterial;
  clubHoardingBanner: PBRMaterial;
  netCord: PBRMaterial;
  ballChalk: PBRMaterial;
  ballHighlightHalo: PBRMaterial;
  stickCarbon: PBRMaterial;
  stickGrip: PBRMaterial;
  jerseyAttackerA: PBRMaterial;
  jerseyAttackerB: PBRMaterial;
  jerseyKeeper: PBRMaterial;
  shortsDarkBlue: PBRMaterial;
  socksHooped: PBRMaterial;
  turfShoeSole: PBRMaterial;
  turfShoeUpper: PBRMaterial;
  turfShoeAccent: PBRMaterial;
  skinLightWarm: PBRMaterial;
  skinRichBrown: PBRMaterial;
  hairDark: PBRMaterial;
  eyeWhite: PBRMaterial;
  keeperFoamPanel: PBRMaterial;
  keeperKicker: PBRMaterial;
  keeperStrap: PBRMaterial;
  keeperHelmetShell: PBRMaterial;
  keeperCageMetal: PBRMaterial;
  keeperGloveDark: PBRMaterial;
  metalFence: PBRMaterial;
  floodlightPole: PBRMaterial;
  dugoutFrame: PBRMaterial;
  clubhouseWall: PBRMaterial;
  clubhouseGlass: PBRMaterial;
  woodBench: PBRMaterial;
}

function buildNormalFromHeightCanvas(
  name: string,
  heightCanvas: HTMLCanvasElement,
  strength: number,
  scene: Scene,
): DynamicTexture {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const srcCtx = heightCanvas.getContext('2d')!;
  const srcData = srcCtx.getImageData(0, 0, w, h).data;

  const tex = new DynamicTexture(name, { width: w, height: h }, scene, true);
  const dstCtx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const outImg = dstCtx.createImageData(w, h);
  const dst = outImg.data;

  const sample = (x: number, y: number): number => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return srcData[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const inv = 1.0 / Math.hypot(nx, ny, nz);
      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }
  dstCtx.putImageData(outImg, 0, 0);
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

function createTurfMaterial(
  name: string,
  baseHex: string,
  stripeHex: string,
  tileScale: number,
  scene: Scene,
): PBRMaterial {
  const size = 512;
  const diffuse = new DynamicTexture(`${name}_diff`, { width: size, height: size }, scene, true);
  const ctx = diffuse.getContext() as unknown as CanvasRenderingContext2D;
  const hCanvas = document.createElement('canvas');
  hCanvas.width = size;
  hCanvas.height = size;
  const hCtx = hCanvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = stripeHex;
  ctx.globalAlpha = 0.14;
  ctx.fillRect(0, 0, size * 0.5, size);
  ctx.globalAlpha = 1.0;

  hCtx.fillStyle = 'rgb(128,128,128)';
  hCtx.fillRect(0, 0, size, size);

  let seed = 1337;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let i = 0; i < 16000; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const bright = rand() > 0.5;
    ctx.fillStyle = bright ? 'rgba(255,255,255,0.065)' : 'rgba(4,16,38,0.10)';
    ctx.fillRect(x, y, 2, 3);
    const hv = Math.round(90 + rand() * 110);
    hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
    hCtx.fillRect(x, y, 2, 2);
  }
  diffuse.update(false);
  diffuse.wrapU = Texture.WRAP_ADDRESSMODE;
  diffuse.wrapV = Texture.WRAP_ADDRESSMODE;
  diffuse.uScale = tileScale;
  diffuse.vScale = tileScale;

  const normal = buildNormalFromHeightCanvas(`${name}_nrm`, hCanvas, 2.2, scene);
  normal.uScale = tileScale;
  normal.vScale = tileScale;

  const mat = new PBRMaterial(name, scene);
  mat.albedoTexture = diffuse;
  mat.bumpTexture = normal;
  mat.bumpTexture.level = 0.65;
  mat.metallic = 0.04;
  mat.roughness = 0.42;
  mat.clearCoat.isEnabled = true;
  mat.clearCoat.intensity = 0.16;
  mat.clearCoat.roughness = 0.32;
  return mat;
}

function createJerseyMaterial(
  name: string,
  primaryHex: string,
  accentHex: string,
  numberText: string,
  isKeeper: boolean,
  scene: Scene,
): PBRMaterial {
  const size = 512;
  const tex = new DynamicTexture(`${name}_diff`, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const hCanvas = document.createElement('canvas');
  hCanvas.width = size;
  hCanvas.height = size;
  const hCtx = hCanvas.getContext('2d')!;

  ctx.fillStyle = primaryHex;
  ctx.fillRect(0, 0, size, size);

  // Subtle side panels & modern sports yoke
  ctx.fillStyle = '#0A2044';
  ctx.fillRect(0, 0, size, 86);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 86, size, 10);

  // Classic Uddingston chest/back band
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 178, size, 52);
  ctx.fillStyle = UDDINGSTON_COLOURS.CHALK;
  ctx.fillRect(0, 171, size, 5);
  ctx.fillRect(0, 232, size, 5);

  // Keep cylindrical jersey texture cleanly striped without upside-down wrapped text;
  // crisp upright jersey numbers & club badges are rendered on dedicated chest/back decal planes.
  if (isKeeper) {
    ctx.fillStyle = '#0D1726';
    ctx.fillRect(0, 290, size, 130);
    ctx.fillStyle = accentHex;
    ctx.fillRect(0, 286, size, 8);
  }
  void numberText;

  hCtx.fillStyle = 'rgb(128,128,128)';
  hCtx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 4) {
    hCtx.fillStyle = y % 8 === 0 ? 'rgb(150,150,150)' : 'rgb(108,108,108)';
    hCtx.fillRect(0, y, size, 2);
  }
  tex.update(false);

  const normal = buildNormalFromHeightCanvas(`${name}_nrm`, hCanvas, 1.25, scene);
  const mat = new PBRMaterial(name, scene);
  mat.albedoTexture = tex;
  mat.bumpTexture = normal;
  mat.bumpTexture.level = 0.4;
  mat.metallic = 0.02;
  mat.roughness = 0.76;
  return mat;
}

function createKeeperPadMaterial(name: string, scene: Scene): PBRMaterial {
  const size = 512;
  const tex = new DynamicTexture(`${name}_diff`, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const hCanvas = document.createElement('canvas');
  hCanvas.width = size;
  hCanvas.height = size;
  const hCtx = hCanvas.getContext('2d')!;

  // Rich sculpted foam pad graphic inspired by reference image, styled in Uddingston Blue, Gold, Chalk & Night
  ctx.fillStyle = '#0D1726';
  ctx.fillRect(0, 0, size, size);

  // Outer Chalk piping frame
  ctx.strokeStyle = UDDINGSTON_COLOURS.CHALK;
  ctx.lineWidth = 14;
  ctx.strokeRect(12, 12, size - 24, size - 24);

  // Swooping curved Uddingston Gold & Deep Blue geometric blades
  ctx.fillStyle = UDDINGSTON_COLOURS.DEEP_BLUE;
  ctx.beginPath();
  ctx.moveTo(22, 120);
  ctx.quadraticCurveTo(size * 0.55, 65, size - 22, 220);
  ctx.lineTo(size - 22, size - 80);
  ctx.quadraticCurveTo(size * 0.45, size - 140, 22, size - 60);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = UDDINGSTON_COLOURS.GOLD;
  ctx.beginPath();
  ctx.moveTo(22, 46);
  ctx.quadraticCurveTo(size * 0.52, 24, size - 22, 165);
  ctx.lineTo(size - 22, 225);
  ctx.quadraticCurveTo(size * 0.52, 85, 22, 125);
  ctx.closePath();
  ctx.fill();

  // Sharp white/gold lower flash
  ctx.fillStyle = UDDINGSTON_COLOURS.CHALK;
  ctx.fillRect(22, size - 78, size - 44, 14);
  ctx.fillStyle = UDDINGSTON_COLOURS.GOLD;
  ctx.fillRect(22, size - 56, size - 44, 24);

  // Horizontal flex-channel foam cushions + perimeter stitch relief
  hCtx.fillStyle = 'rgb(152,152,152)';
  hCtx.fillRect(0, 0, size, size);
  for (let y = 80; y < size - 40; y += 84) {
    hCtx.fillStyle = 'rgb(52,52,52)';
    hCtx.fillRect(16, y - 4, size - 32, 8);
    hCtx.fillStyle = 'rgb(200,200,200)';
    hCtx.fillRect(16, y + 4, size - 32, 4);
  }
  hCtx.strokeStyle = 'rgb(40,40,40)';
  hCtx.lineWidth = 10;
  hCtx.strokeRect(10, 10, size - 20, size - 20);
  tex.update(false);

  const normal = buildNormalFromHeightCanvas(`${name}_nrm`, hCanvas, 2.2, scene);
  const mat = new PBRMaterial(name, scene);
  mat.albedoTexture = tex;
  mat.bumpTexture = normal;
  mat.bumpTexture.level = 0.75;
  mat.metallic = 0.08;
  mat.roughness = 0.42;
  return mat;
}

function createCarbonStickMaterial(scene: Scene): PBRMaterial {
  const size = 256;
  const tex = new DynamicTexture('stick_carbon_diff', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const hCanvas = document.createElement('canvas');
  hCanvas.width = size;
  hCanvas.height = size;
  const hCtx = hCanvas.getContext('2d')!;

  ctx.fillStyle = '#141B24';
  ctx.fillRect(0, 0, size, size);
  hCtx.fillStyle = 'rgb(120,120,120)';
  hCtx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 8) {
    for (let x = 0; x < size; x += 8) {
      const alt = ((x + y) / 8) % 2 === 0;
      ctx.fillStyle = alt ? '#1E2A3B' : '#0E131B';
      ctx.fillRect(x, y, 8, 8);
      hCtx.fillStyle = alt ? 'rgb(155,155,155)' : 'rgb(100,100,100)';
      hCtx.fillRect(x, y, 7, 7);
    }
  }
  ctx.fillStyle = UDDINGSTON_COLOURS.GOLD;
  ctx.fillRect(0, 96, size, 18);
  ctx.fillStyle = UDDINGSTON_COLOURS.DEEP_BLUE;
  ctx.fillRect(0, 116, size, 26);
  tex.update(false);

  const normal = buildNormalFromHeightCanvas('stick_carbon_nrm', hCanvas, 1.5, scene);
  const mat = new PBRMaterial('stick_carbon_mat', scene);
  mat.albedoTexture = tex;
  mat.bumpTexture = normal;
  mat.metallic = 0.25;
  mat.roughness = 0.24;
  mat.clearCoat.isEnabled = true;
  mat.clearCoat.intensity = 0.45;
  return mat;
}

function createBannerMaterial(
  name: string,
  title: string,
  subtitle: string,
  widthPx: number,
  heightPx: number,
  flipU: boolean,
  scene: Scene,
): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  const tex = new DynamicTexture(`${name}_tex`, { width: widthPx, height: heightPx }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

  ctx.fillStyle = '#0D264F';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = UDDINGSTON_COLOURS.GOLD;
  ctx.fillRect(0, 0, widthPx, 14);
  ctx.fillRect(0, heightPx - 8, widthPx, 8);

  ctx.fillStyle = UDDINGSTON_COLOURS.CHALK;
  ctx.font = 'bold 34px Inter, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, widthPx * 0.5, heightPx * 0.56);

  if (subtitle) {
    ctx.fillStyle = UDDINGSTON_COLOURS.GOLD;
    ctx.font = 'bold 18px Inter, Segoe UI, sans-serif';
    ctx.fillText(subtitle, widthPx * 0.5, heightPx * 0.8);
  }

  tex.update(false);
  if (flipU) {
    tex.uScale = -1;
    tex.uOffset = 1;
  }
  mat.albedoTexture = tex;
  mat.metallic = 0.05;
  mat.roughness = 0.48;
  return mat;
}

function createSimplePBR(
  name: string,
  hex: string,
  metallic: number,
  roughness: number,
  scene: Scene,
): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  mat.albedoColor = Color3.FromHexString(hex);
  mat.metallic = metallic;
  mat.roughness = roughness;
  return mat;
}

export function createMaterialPalette(scene: Scene): MaterialPalette {
  const pitchLine = createSimplePBR('pitch_line', UDDINGSTON_COLOURS.CHALK, 0.0, 0.55, scene);
  pitchLine.emissiveColor = Color3.FromHexString('#222730');

  // uScale = -1 corrects Babylon CreateBox +Z face horizontal orientation so text reads left-to-right!
  const backboardBlueGold = createBannerMaterial(
    'backboard_bg',
    'UDDINGSTON HOCKEY CLUB',
    '',
    512,
    128,
    true,
    scene,
  );
  const clubHoardingBanner = createBannerMaterial(
    'club_hoarding',
    'UDDINGSTON HOCKEY CLUB  ·  EIGHT SECONDS',
    'BLUE & GOLD  ·  OUTDOOR FIELD HOCKEY',
    1024,
    128,
    true,
    scene,
  );

  const netCord = new PBRMaterial('net_cord', scene);
  netCord.albedoColor = Color3.FromHexString('#E4EBF5');
  netCord.metallic = 0.0;
  netCord.roughness = 0.72;
  netCord.wireframe = true;
  netCord.backFaceCulling = false;

  const ballChalk = createSimplePBR('ball_chalk', UDDINGSTON_COLOURS.CHALK, 0.04, 0.24, scene);
  ballChalk.emissiveColor = Color3.FromHexString('#1E222A');
  ballChalk.clearCoat.isEnabled = true;
  ballChalk.clearCoat.intensity = 0.5;

  const ballHighlightHalo = createSimplePBR('ball_halo', UDDINGSTON_COLOURS.GOLD, 0.0, 0.4, scene);
  ballHighlightHalo.emissiveColor = Color3.FromHexString(UDDINGSTON_COLOURS.GOLD);
  ballHighlightHalo.alpha = 0.55;

  const socksHooped = new PBRMaterial('socks_hooped', scene);
  const sockTex = new DynamicTexture('socks_tex', { width: 128, height: 256 }, scene, true);
  const sCtx = sockTex.getContext() as unknown as CanvasRenderingContext2D;
  sCtx.fillStyle = UDDINGSTON_COLOURS.DEEP_BLUE;
  sCtx.fillRect(0, 0, 128, 256);
  sCtx.fillStyle = UDDINGSTON_COLOURS.GOLD;
  sCtx.fillRect(0, 26, 128, 28);
  sCtx.fillRect(0, 74, 128, 28);
  sockTex.update(false);
  socksHooped.albedoTexture = sockTex;
  socksHooped.metallic = 0.0;
  socksHooped.roughness = 0.85;

  return {
    turfPlay: createTurfMaterial('turf_play', '#155091', '#185AA3', 28, scene),
    turfRunoff: createTurfMaterial('turf_runoff', '#1B5A42', '#1F664B', 22, scene),
    pitchLine,
    goalFrameWhite: createSimplePBR('goal_frame', '#F4F7FC', 0.35, 0.32, scene),
    backboardBlueGold,
    clubHoardingBanner,
    netCord,
    ballChalk,
    ballHighlightHalo,
    stickCarbon: createCarbonStickMaterial(scene),
    stickGrip: createSimplePBR('stick_grip', '#181C22', 0.05, 0.82, scene),
    jerseyAttackerA: createJerseyMaterial(
      'jersey_att_a',
      UDDINGSTON_COLOURS.DEEP_BLUE,
      UDDINGSTON_COLOURS.GOLD,
      '9',
      false,
      scene,
    ),
    jerseyAttackerB: createJerseyMaterial(
      'jersey_att_b',
      UDDINGSTON_COLOURS.DEEP_BLUE,
      UDDINGSTON_COLOURS.GOLD,
      '11',
      false,
      scene,
    ),
    jerseyKeeper: createJerseyMaterial(
      'jersey_keeper',
      '#142238',
      UDDINGSTON_COLOURS.GOLD,
      '1',
      true,
      scene,
    ),
    shortsDarkBlue: createSimplePBR('shorts_blue', '#0A1A36', 0.02, 0.78, scene),
    socksHooped,
    turfShoeSole: createSimplePBR('shoe_sole', '#10141A', 0.05, 0.75, scene),
    turfShoeUpper: createSimplePBR('shoe_upper', '#1D4C94', 0.08, 0.48, scene),
    turfShoeAccent: createSimplePBR('shoe_accent', UDDINGSTON_COLOURS.GOLD, 0.1, 0.4, scene),
    skinLightWarm: createSimplePBR('skin_light', '#E5B594', 0.0, 0.56, scene),
    skinRichBrown: createSimplePBR('skin_brown', '#805237', 0.0, 0.54, scene),
    hairDark: createSimplePBR('hair_dark', '#1C1613', 0.05, 0.72, scene),
    eyeWhite: createSimplePBR('eye_white', '#F5F7FA', 0.0, 0.3, scene),
    keeperFoamPanel: createKeeperPadMaterial('keeper_foam_panel', scene),
    keeperKicker: createKeeperPadMaterial('keeper_kicker', scene),
    keeperStrap: createSimplePBR('keeper_strap', '#18212E', 0.15, 0.6, scene),
    keeperHelmetShell: createSimplePBR('keeper_helmet', UDDINGSTON_COLOURS.DEEP_BLUE, 0.18, 0.18, scene),
    keeperCageMetal: createSimplePBR('keeper_cage', '#DCE3EC', 0.88, 0.2, scene),
    keeperGloveDark: createSimplePBR('keeper_glove', '#162338', 0.05, 0.52, scene),
    metalFence: createSimplePBR('metal_fence', '#374252', 0.78, 0.42, scene),
    floodlightPole: createSimplePBR('floodlight_pole', '#5B6778', 0.75, 0.36, scene),
    dugoutFrame: createSimplePBR('dugout_frame', '#12294F', 0.5, 0.4, scene),
    clubhouseWall: createSimplePBR('clubhouse_wall', '#2B3A52', 0.1, 0.78, scene),
    clubhouseGlass: createSimplePBR('clubhouse_glass', '#9CC2EB', 0.3, 0.12, scene),
    woodBench: createSimplePBR('wood_bench', '#6D4F35', 0.05, 0.76, scene),
  };
}
