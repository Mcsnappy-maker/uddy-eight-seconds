import {
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  ShadowGenerator,
  SpotLight,
  Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core';
import { FIH, UDDINGSTON_COLOURS, Vec3 } from '../rules/RulesConfig';
import { LightingPreset, QualityTier } from './EngineManager';
import { MaterialPalette } from './PBRMaterials';

export class VenueScene {
  private readonly scene: Scene;
  private readonly palette: MaterialPalette;
  public shadowGenerator: ShadowGenerator | null = null;
  private mainSunLight!: DirectionalLight;
  private hemiLight!: HemisphericLight;
  private floodSpotLights: SpotLight[] = [];
  private pipeline: DefaultRenderingPipeline | null = null;
  private netMesh!: Mesh;
  private netBasePositions!: Float32Array;
  private netDeformEnergy = 0;
  private netImpactLocal = new Vector3(0, 1.0, -1.0);
  private turfSpraySystem: ParticleSystem | null = null;
  private spectatorNodes: TransformNode[] = [];
  private qualityTier: QualityTier = 'showcase';
  private lightingPreset: LightingPreset = 'floodlit';

  constructor(scene: Scene, palette: MaterialPalette) {
    this.scene = scene;
    this.palette = palette;
    this.buildLights();
    this.buildPitchAndLines();
    this.buildGoalAndNet();
    this.buildSurroundingsAndCrowd();
    this.buildSprayParticles();
    this.applyAtmosphere(this.lightingPreset, this.qualityTier);
  }

  private buildLights(): void {
    this.hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);
    this.hemiLight.intensity = 0.55;
    this.hemiLight.diffuse = Color3.FromHexString('#DCE9FF');
    this.hemiLight.groundColor = Color3.FromHexString('#12243E');

    this.mainSunLight = new DirectionalLight(
      'key_light',
      new Vector3(-0.42, -0.78, -0.46).normalize(),
      this.scene,
    );
    this.mainSunLight.position = new Vector3(18, 28, 24);
    this.mainSunLight.intensity = 2.6;

    this.shadowGenerator = new ShadowGenerator(2048, this.mainSunLight);
    this.shadowGenerator.usePercentageCloserFiltering = true;
    this.shadowGenerator.bias = 0.0004;
    this.shadowGenerator.normalBias = 0.015;

    // 4 Corner Floodlight Spots aimed onto the shooting circle & goal mouth
    const floodPositions = [
      new Vector3(-28, 16, 28),
      new Vector3(28, 16, 28),
      new Vector3(-28, 16, -6),
      new Vector3(28, 16, -6),
    ];
    for (let i = 0; i < floodPositions.length; i += 1) {
      const pos = floodPositions[i];
      const target = new Vector3(0, 0.5, 9);
      const dir = target.subtract(pos).normalize();
      const spot = new SpotLight(`flood_${i}`, pos, dir, Math.PI * 0.42, 18, this.scene);
      spot.diffuse = Color3.FromHexString('#F2F7FF');
      spot.intensity = 1.65;
      this.floodSpotLights.push(spot);
    }
  }

  private buildPitchAndLines(): void {
    // Green outer perimeter runoff turf
    const runoff = MeshBuilder.CreateGround(
      'turf_runoff',
      { width: 68, height: 64, subdivisions: 2 },
      this.scene,
    );
    runoff.position = new Vector3(0, -0.004, 21);
    runoff.material = this.palette.turfRunoff;
    runoff.receiveShadows = true;
    runoff.freezeWorldMatrix();

    // Water-based Blue FIH pitch (55m wide, attacking half + midfield buffer)
    const pitch = MeshBuilder.CreateGround(
      'turf_play',
      { width: FIH.PITCH_WIDTH, height: 50, subdivisions: 4 },
      this.scene,
    );
    pitch.position = new Vector3(0, 0, 25);
    pitch.material = this.palette.turfPlay;
    pitch.receiveShadows = true;
    pitch.freezeWorldMatrix();

    // Crisp 3D ribbon pitch markings at y = 0.002 m (exact FIH 75mm width)
    const lineH = 0.002;
    const addLineStrip = (name: string, x1: number, z1: number, x2: number, z2: number, width = FIH.LINE_WIDTH) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.001) return;
      const strip = MeshBuilder.CreateBox(name, { width, height: 0.003, depth: len }, this.scene);
      strip.position = new Vector3((x1 + x2) * 0.5, lineH, (z1 + z2) * 0.5);
      strip.rotation.y = Math.atan2(x2 - x1, z2 - z1);
      strip.material = this.palette.pitchLine;
      strip.receiveShadows = true;
      strip.freezeWorldMatrix();
    };

    // Back-line (scoring inner edge at z = 0, so line spans z = 0 to z = +0.075)
    addLineStrip('line_backline', -FIH.PITCH_HALF_WIDTH, FIH.LINE_WIDTH * 0.5, FIH.PITCH_HALF_WIDTH, FIH.LINE_WIDTH * 0.5);
    // Sidelines
    addLineStrip('line_side_l', -FIH.PITCH_HALF_WIDTH, 0, -FIH.PITCH_HALF_WIDTH, 49.5);
    addLineStrip('line_side_r', FIH.PITCH_HALF_WIDTH, 0, FIH.PITCH_HALF_WIDTH, 49.5);
    // 23 m line & Halfway line
    addLineStrip('line_23m', -FIH.PITCH_HALF_WIDTH, FIH.LINE_23M_DISTANCE, FIH.PITCH_HALF_WIDTH, FIH.LINE_23M_DISTANCE);
    addLineStrip('line_half', -FIH.PITCH_HALF_WIDTH, FIH.PITCH_HALF_LENGTH, FIH.PITCH_HALF_WIDTH, FIH.PITCH_HALF_LENGTH);

    // Shooting circle: straight 3.66 m section at z = 14.63 m
    addLineStrip('circle_straight', -FIH.CIRCLE_STRAIGHT_HALF, FIH.CIRCLE_RADIUS, FIH.CIRCLE_STRAIGHT_HALF, FIH.CIRCLE_RADIUS);

    // Shooting circle quarter-arcs centered at (±1.83, 0)
    const arcSegments = 36;
    for (const side of [-1, 1]) {
      const cx = side * FIH.CIRCLE_STRAIGHT_HALF;
      for (let i = 0; i < arcSegments; i += 1) {
        const a0 = (i / arcSegments) * (Math.PI * 0.5);
        const a1 = ((i + 1) / arcSegments) * (Math.PI * 0.5);
        const x0 = cx + side * FIH.CIRCLE_RADIUS * Math.sin(a0);
        const z0 = FIH.CIRCLE_RADIUS * Math.cos(a0);
        const x1 = cx + side * FIH.CIRCLE_RADIUS * Math.sin(a1);
        const z1 = FIH.CIRCLE_RADIUS * Math.cos(a1);
        addLineStrip(`circle_arc_${side}_${i}`, x0, z0, x1, z1);
      }
    }

    // 5m broken circle outside shooting circle (straight dash + dashed arcs)
    const outerR = FIH.CIRCLE_RADIUS + FIH.CIRCLE_FIVE_METER_OFFSET;
    for (let dx = -1.65; dx <= 1.65; dx += 0.66) {
      addLineStrip(`circle5_s_${dx}`, dx - 0.15, outerR, dx + 0.15, outerR);
    }
    for (const side of [-1, 1]) {
      const cx = side * FIH.CIRCLE_STRAIGHT_HALF;
      for (let i = 0; i < 14; i += 1) {
        const a0 = ((i + 0.25) / 14) * (Math.PI * 0.5);
        const a1 = ((i + 0.55) / 14) * (Math.PI * 0.5);
        addLineStrip(
          `circle5_a_${side}_${i}`,
          cx + side * outerR * Math.sin(a0),
          outerR * Math.cos(a0),
          cx + side * outerR * Math.sin(a1),
          outerR * Math.cos(a1),
        );
      }
    }

    // Penalty Spot (6.475 m) & 23m Shoot-Out Start Spot
    const pSpot = MeshBuilder.CreateCylinder(
      'penalty_spot',
      { height: 0.004, diameter: FIH.PENALTY_SPOT_RADIUS * 2, tessellation: 16 },
      this.scene,
    );
    pSpot.position = new Vector3(0, lineH, FIH.PENALTY_SPOT_DISTANCE);
    pSpot.material = this.palette.pitchLine;
    pSpot.freezeWorldMatrix();

    const soSpot = MeshBuilder.CreateCylinder(
      'shootout_spot',
      { height: 0.004, diameter: 0.14, tessellation: 16 },
      this.scene,
    );
    soSpot.position = new Vector3(0, lineH, FIH.LINE_23M_DISTANCE);
    soSpot.material = this.palette.pitchLine;
    soSpot.freezeWorldMatrix();
  }

  private buildGoalAndNet(): void {
    const postW = FIH.GOAL_POST_WIDTH;
    const postD = FIH.GOAL_POST_DEPTH;
    const postZ = postD * 0.5;
    const postH = FIH.GOAL_HEIGHT + postW;

    // Left & Right uprights + Crossbar
    const postL = MeshBuilder.CreateBox('goal_post_L', { width: postW, height: postH, depth: postD }, this.scene);
    postL.position = new Vector3(-(FIH.GOAL_HALF_WIDTH + postW * 0.5), postH * 0.5, postZ);
    postL.material = this.palette.goalFrameWhite;

    const postR = MeshBuilder.CreateBox('goal_post_R', { width: postW, height: postH, depth: postD }, this.scene);
    postR.position = new Vector3(FIH.GOAL_HALF_WIDTH + postW * 0.5, postH * 0.5, postZ);
    postR.material = this.palette.goalFrameWhite;

    const crossbar = MeshBuilder.CreateBox(
      'goal_crossbar',
      { width: FIH.GOAL_WIDTH + postW * 2, height: postW, depth: postD },
      this.scene,
    );
    crossbar.position = new Vector3(0, FIH.GOAL_HEIGHT + postW * 0.5, postZ);
    crossbar.material = this.palette.goalFrameWhite;

    // Rear support stanchions
    for (const side of [-1, 1]) {
      const topBar = MeshBuilder.CreateBox('goal_top_bar', { width: 0.04, height: 0.04, depth: FIH.GOAL_DEPTH_TOP }, this.scene);
      topBar.position = new Vector3(side * (FIH.GOAL_HALF_WIDTH + 0.025), FIH.GOAL_HEIGHT + 0.02, -FIH.GOAL_DEPTH_TOP * 0.5);
      topBar.material = this.palette.goalFrameWhite;

      const backSupport = MeshBuilder.CreateCylinder(
        `goal_rear_${side}`,
        { height: 2.18, diameter: 0.036 },
        this.scene,
      );
      backSupport.position = new Vector3(side * (FIH.GOAL_HALF_WIDTH + 0.025), 1.07, -1.06);
      backSupport.rotation.x = 0.14;
      backSupport.material = this.palette.goalFrameWhite;
    }

    // Backboard & Sideboards (0.46 m high)
    const bbH = FIH.BACKBOARD_HEIGHT;
    const bbBack = MeshBuilder.CreateBox(
      'goal_backboard_mesh',
      { width: FIH.GOAL_WIDTH + 0.07, height: bbH, depth: 0.035 },
      this.scene,
    );
    bbBack.position = new Vector3(0, bbH * 0.5, -FIH.GOAL_DEPTH_BOTTOM - 0.0175);
    bbBack.material = this.palette.backboardBlueGold;

    for (const side of [-1, 1]) {
      const sb = MeshBuilder.CreateBox(
        `goal_sideboard_${side}`,
        { width: 0.035, height: bbH, depth: FIH.GOAL_DEPTH_BOTTOM },
        this.scene,
      );
      sb.position = new Vector3(side * (FIH.GOAL_HALF_WIDTH + 0.0175), bbH * 0.5, -FIH.GOAL_DEPTH_BOTTOM * 0.5);
      sb.material = this.palette.backboardBlueGold;
    }

    // Deformable Cord Net Mesh (back + roof + sides)
    this.netMesh = this.createDeformableNetMesh();
    this.netBasePositions = new Float32Array(this.netMesh.getVerticesData(VertexBuffer.PositionKind)!);

    if (this.shadowGenerator) {
      for (const m of [postL, postR, crossbar, bbBack]) {
        m.receiveShadows = true;
        this.shadowGenerator.addShadowCaster(m, false);
      }
    }
  }

  private createDeformableNetMesh(): Mesh {
    const net = MeshBuilder.CreateBox(
      'goal_net_mesh',
      { width: FIH.GOAL_WIDTH, height: FIH.GOAL_HEIGHT - FIH.BACKBOARD_HEIGHT, depth: FIH.GOAL_DEPTH_BOTTOM - 0.08, updatable: true },
      this.scene,
    );
    // Subdivide net manually via ribbon? Better: use a custom updatable subdivided box/grid for clean cord grid!
    net.dispose();

    const cols = 24;
    const rows = 12;
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];

    // Back net panel spanning x in [-1.83, 1.83], y in [0.46, 2.14]
    for (let r = 0; r <= rows; r += 1) {
      const ry = r / rows;
      const y = FIH.BACKBOARD_HEIGHT + ry * (FIH.GOAL_HEIGHT - FIH.BACKBOARD_HEIGHT);
      const z = -(FIH.GOAL_DEPTH_BOTTOM * (1 - ry * 0.25));
      for (let c = 0; c <= cols; c += 1) {
        const cx = c / cols;
        const x = -FIH.GOAL_HALF_WIDTH + cx * FIH.GOAL_WIDTH;
        positions.push(x, y, z);
        normals.push(0, 0, 1);
      }
    }
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i0 = r * (cols + 1) + c;
        const i1 = i0 + 1;
        const i2 = i0 + cols + 1;
        const i3 = i2 + 1;
        indices.push(i0, i1, i2, i1, i3, i2);
      }
    }

    const customNet = new Mesh('goal_net_back', this.scene);
    customNet.setVerticesData(VertexBuffer.PositionKind, positions, true);
    customNet.setVerticesData(VertexBuffer.NormalKind, normals, true);
    customNet.setIndices(indices);
    customNet.material = this.palette.netCord;

    // Static roof & side net panels for complete enclosure
    const roof = MeshBuilder.CreateGround('goal_net_roof', { width: FIH.GOAL_WIDTH, height: FIH.GOAL_DEPTH_TOP, subdivisions: 10 }, this.scene);
    roof.position = new Vector3(0, FIH.GOAL_HEIGHT, -FIH.GOAL_DEPTH_TOP * 0.5);
    roof.rotation.x = Math.PI;
    roof.material = this.palette.netCord;

    for (const side of [-1, 1]) {
      const sideNet = MeshBuilder.CreatePlane(
        `goal_net_side_${side}`,
        { width: FIH.GOAL_DEPTH_BOTTOM, height: FIH.GOAL_HEIGHT - FIH.BACKBOARD_HEIGHT },
        this.scene,
      );
      sideNet.position = new Vector3(side * FIH.GOAL_HALF_WIDTH, (FIH.GOAL_HEIGHT + FIH.BACKBOARD_HEIGHT) * 0.5, -FIH.GOAL_DEPTH_BOTTOM * 0.5);
      sideNet.rotation.y = side * Math.PI * 0.5;
      sideNet.material = this.palette.netCord;
    }

    return customNet;
  }

  public triggerNetRipple(point: Vec3): void {
    this.netDeformEnergy = 1.0;
    this.netImpactLocal.set(point.x, point.y, point.z);
  }

  public updateVisualEffects(dt: number, elapsedTime: number): void {
    // Animate deformable goal net ripple
    if (this.netDeformEnergy > 0.005 && this.netMesh) {
      this.netDeformEnergy *= Math.exp(-3.4 * dt);
      const posAttr = this.netMesh.getVerticesData(VertexBuffer.PositionKind);
      if (posAttr) {
        const wave = Math.sin(elapsedTime * 26) * 0.19 * this.netDeformEnergy;
        for (let i = 0; i < posAttr.length; i += 3) {
          const bx = this.netBasePositions[i];
          const by = this.netBasePositions[i + 1];
          const bz = this.netBasePositions[i + 2];
          // Pin edges at frame/backboard
          const edgeX = 1 - Math.pow(Math.abs(bx) / FIH.GOAL_HALF_WIDTH, 2);
          const edgeY = Math.sin(((by - FIH.BACKBOARD_HEIGHT) / (FIH.GOAL_HEIGHT - FIH.BACKBOARD_HEIGHT)) * Math.PI);
          const dist = Math.hypot(bx - this.netImpactLocal.x, by - this.netImpactLocal.y);
          const falloff = Math.exp(-dist * 1.15);
          posAttr[i + 2] = bz - Math.abs(wave) * edgeX * edgeY * falloff - wave * 0.35 * edgeX * edgeY * falloff;
        }
        this.netMesh.updateVerticesData(VertexBuffer.PositionKind, posAttr);
      }
    }

    // Subtle animated spectator sway
    for (let i = 0; i < this.spectatorNodes.length; i += 1) {
      const spec = this.spectatorNodes[i];
      spec.position.y = Math.abs(Math.sin(elapsedTime * 1.8 + i * 0.7)) * 0.02;
    }
  }

  private buildSurroundingsAndCrowd(): void {
    // Perimeter boundary boards / fencing behind goal and sidelines
    const fenceBack = MeshBuilder.CreateBox('fence_back', { width: 64, height: 1.35, depth: 0.12 }, this.scene);
    fenceBack.position = new Vector3(0, 0.675, -5.2);
    fenceBack.material = this.palette.metalFence;
    fenceBack.freezeWorldMatrix();

    // Pitch-side Uddingston Hockey Club perimeter hoarding boards flanking behind goal
    for (const bx of [-16, -8, 8, 16]) {
      const board = MeshBuilder.CreateBox(`hoarding_${bx}`, { width: 7.4, height: 1.02, depth: 0.08 }, this.scene);
      board.position = new Vector3(bx, 0.52, -5.08);
      board.material = this.palette.clubHoardingBanner;
      board.freezeWorldMatrix();
    }

    // High ball-stop mesh posts behind goal
    for (let x = -18; x <= 18; x += 4.5) {
      const p = MeshBuilder.CreateCylinder(`ballstop_${x}`, { height: 5.2, diameter: 0.1 }, this.scene);
      p.position = new Vector3(x, 2.6, -5.25);
      p.material = this.palette.floodlightPole;
      p.freezeWorldMatrix();
    }

    // Uddy TV Gantry Platform on sideline (+X = left side from gameplay camera)
    const gantryDeck = MeshBuilder.CreateBox('gantry_deck', { width: 2.4, height: 0.25, depth: 6.0 }, this.scene);
    gantryDeck.position = new Vector3(31.2, 4.6, 12);
    gantryDeck.material = this.palette.dugoutFrame;
    gantryDeck.freezeWorldMatrix();

    for (const dz of [-2.6, 2.6]) {
      const leg = MeshBuilder.CreateCylinder(`gantry_leg_${dz}`, { height: 4.6, diameter: 0.18 }, this.scene);
      leg.position = new Vector3(31.2, 2.3, 12 + dz);
      leg.material = this.palette.floodlightPole;
      leg.freezeWorldMatrix();
    }

    // Team Dugouts along -X and +X sidelines
    for (const side of [-1, 1]) {
      const shelter = MeshBuilder.CreateBox(`dugout_${side}`, { width: 1.6, height: 2.2, depth: 7.2 }, this.scene);
      shelter.position = new Vector3(side * 30.2, 1.1, 19);
      shelter.material = this.palette.dugoutFrame;
      shelter.freezeWorldMatrix();

      const bench = MeshBuilder.CreateBox(`bench_${side}`, { width: 0.6, height: 0.45, depth: 6.4 }, this.scene);
      bench.position = new Vector3(side * 29.8, 0.24, 19);
      bench.material = this.palette.woodBench;
      bench.freezeWorldMatrix();
    }

    // Two-storey Uddingston-inspired Sports Pavilion backdrop (clubhouse ground floor + viewing gallery + pitched overhang)
    const lowerHall = MeshBuilder.CreateBox('clubhouse_base', { width: 30, height: 3.1, depth: 8.6 }, this.scene);
    lowerHall.position = new Vector3(-7.5, 1.55, -14.8);
    lowerHall.material = this.palette.clubhouseWall;
    lowerHall.freezeWorldMatrix();

    const upperGallery = MeshBuilder.CreateBox('clubhouse_upper', { width: 29, height: 3.0, depth: 7.4 }, this.scene);
    upperGallery.position = new Vector3(-7.5, 4.6, -15.4);
    upperGallery.material = this.palette.dugoutFrame;
    upperGallery.freezeWorldMatrix();

    const balconyDeck = MeshBuilder.CreateBox('clubhouse_balcony', { width: 30.2, height: 0.28, depth: 2.2 }, this.scene);
    balconyDeck.position = new Vector3(-7.5, 3.15, -10.8);
    balconyDeck.material = this.palette.turfShoeSole;
    balconyDeck.freezeWorldMatrix();

    const balconyRail = MeshBuilder.CreateBox('clubhouse_rail', { width: 30.2, height: 0.95, depth: 0.08 }, this.scene);
    balconyRail.position = new Vector3(-7.5, 3.76, -9.75);
    balconyRail.material = this.palette.clubhouseGlass;
    balconyRail.freezeWorldMatrix();

    for (let wx = -19.5; wx <= 4.5; wx += 4.8) {
      const win = MeshBuilder.CreateBox(`clubhouse_win_${wx}`, { width: 3.6, height: 1.9, depth: 0.14 }, this.scene);
      win.position = new Vector3(wx, 4.7, -11.66);
      win.material = this.palette.clubhouseGlass;
      win.freezeWorldMatrix();
    }
    for (let cx = -22; cx <= 7; cx += 5.8) {
      const col = MeshBuilder.CreateBox(`clubhouse_col_${cx}`, { width: 0.42, height: 6.2, depth: 0.48 }, this.scene);
      col.position = new Vector3(cx, 3.1, -9.9);
      col.material = this.palette.dugoutFrame;
      col.freezeWorldMatrix();
    }

    const roof = MeshBuilder.CreateBox('clubhouse_roof', { width: 31.6, height: 0.48, depth: 10.4 }, this.scene);
    roof.position = new Vector3(-7.5, 6.32, -14.2);
    roof.rotation.x = 0.08;
    roof.material = this.palette.turfShoeSole;
    roof.freezeWorldMatrix();

    // Matte organic perimeter treeline clusters behind back boundary (Scottish park ground feel, zero shiny balls)
    for (let tx = -34; tx <= 34; tx += 5.5) {
      if (tx > -22 && tx < 9) continue;
      const tz = -12.5 - (Math.abs(tx) % 3);
      const trunk = MeshBuilder.CreateCylinder(`tree_tr_${tx}`, { height: 2.6, diameter: 0.42 }, this.scene);
      trunk.position = new Vector3(tx, 1.3, tz);
      trunk.material = this.palette.woodBench;
      trunk.freezeWorldMatrix();

      const offsets = [
        [0, 3.8, 0, 3.2, 2.5],
        [-1.1, 3.3, 0.5, 2.4, 2.0],
        [1.1, 3.4, -0.4, 2.5, 2.1],
        [0.2, 4.9, 0.1, 2.2, 1.8],
      ];
      for (let p = 0; p < offsets.length; p += 1) {
        const [ox, oy, oz, w, h] = offsets[p];
        const puff = MeshBuilder.CreateSphere(`tree_can_${tx}_${p}`, { diameterX: w, diameterY: h, diameterZ: w * 0.9, segments: 8 }, this.scene);
        puff.position = new Vector3(tx + ox, oy, tz + oz);
        puff.material = this.palette.foliageMatte;
        puff.freezeWorldMatrix();
      }
    }

    // 6 Floodlight Towers
    const towerCoords = [
      [-31, -4],
      [31, -4],
      [-31, 24],
      [31, 24],
      [-31, 46],
      [31, 46],
    ];
    for (let i = 0; i < towerCoords.length; i += 1) {
      const [tx, tz] = towerCoords[i];
      const mast = MeshBuilder.CreateCylinder(`tower_${i}`, { height: 16, diameter: 0.34 }, this.scene);
      mast.position = new Vector3(tx, 8, tz);
      mast.material = this.palette.floodlightPole;
      mast.freezeWorldMatrix();

      const head = MeshBuilder.CreateBox(`tower_head_${i}`, { width: 1.8, height: 0.7, depth: 0.4 }, this.scene);
      head.position = new Vector3(tx, 16.1, tz);
      head.lookAt(new Vector3(0, 0, 10));
      head.material = this.palette.pitchLine;
      head.freezeWorldMatrix();
    }

    // Articulated spectator figures behind the back fence (shoulders, jackets, scarves, heads)
    for (let i = 0; i < 22; i += 1) {
      const sx = -16 + i * 1.5 + ((i % 3) - 1) * 0.2;
      const sz = -6.2 - (i % 2) * 0.75;
      const specNode = new TransformNode(`spec_${i}`, this.scene);
      specNode.position = new Vector3(sx, 0, sz);

      const coat = MeshBuilder.CreateCylinder(
        `spec_b_${i}`,
        { height: 0.92, diameterTop: 0.42, diameterBottom: 0.36, tessellation: 12 },
        this.scene,
      );
      coat.position.y = 1.05;
      coat.scaling = new Vector3(1.1, 1.0, 0.72);
      coat.material = i % 3 === 0 ? this.palette.jerseyAttackerA : i % 3 === 1 ? this.palette.dugoutFrame : this.palette.shortsDarkBlue;
      coat.parent = specNode;

      const scarf = MeshBuilder.CreateCylinder(
        `spec_sc_${i}`,
        { height: 0.14, diameter: 0.28, tessellation: 10 },
        this.scene,
      );
      scarf.position.y = 1.48;
      scarf.material = i % 2 === 0 ? this.palette.turfShoeAccent : this.palette.dugoutFrame;
      scarf.parent = specNode;

      for (const armSide of [-1, 1]) {
        const arm = MeshBuilder.CreateCapsule(`spec_arm_${i}_${armSide}`, { height: 0.5, radius: 0.06 }, this.scene);
        arm.position = new Vector3(armSide * 0.24, 1.18, 0.03);
        arm.rotation.z = armSide * -0.14;
        arm.material = coat.material;
        arm.parent = specNode;
      }

      const head = MeshBuilder.CreateSphere(`spec_h_${i}`, { diameter: 0.21 }, this.scene);
      head.position.y = 1.66;
      head.material = i % 2 === 0 ? this.palette.skinLightWarm : this.palette.skinRichBrown;
      head.parent = specNode;

      const hair = MeshBuilder.CreateSphere(`spec_hair_${i}`, { diameter: 0.22 }, this.scene);
      hair.position = new Vector3(0, 1.7, -0.02);
      hair.material = this.palette.hairDark;
      hair.parent = specNode;

      this.spectatorNodes.push(specNode);
    }
  }

  private buildSprayParticles(): void {
    const texSize = 64;
    const texCanvas = document.createElement('canvas');
    texCanvas.width = texSize;
    texCanvas.height = texSize;
    const tCtx = texCanvas.getContext('2d')!;
    const grad = tCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.6, 'rgba(200,230,255,0.6)');
    grad.addColorStop(1, 'rgba(200,230,255,0)');
    tCtx.fillStyle = grad;
    tCtx.fillRect(0, 0, texSize, texSize);

    const ps = new ParticleSystem('turf_spray', 120, this.scene);
    ps.particleTexture = new Texture(texCanvas.toDataURL(), this.scene);
    ps.minEmitBox = new Vector3(-0.08, 0, -0.08);
    ps.maxEmitBox = new Vector3(0.08, 0.04, 0.08);
    ps.color1 = new Color4(0.85, 0.93, 1.0, 0.7);
    ps.color2 = new Color4(0.25, 0.55, 0.95, 0.35);
    ps.minSize = 0.02;
    ps.maxSize = 0.055;
    ps.minLifeTime = 0.16;
    ps.maxLifeTime = 0.38;
    ps.emitRate = 0;
    ps.direction1 = new Vector3(-1.2, 1.6, -1.2);
    ps.direction2 = new Vector3(1.2, 2.8, 1.2);
    ps.gravity = new Vector3(0, -9.8, 0);
    ps.start();
    this.turfSpraySystem = ps;
  }

  public burstTurfSpray(worldPos: Vec3, count: number = 18): void {
    if (!this.turfSpraySystem || this.qualityTier === 'compatible') return;
    this.turfSpraySystem.emitter = new Vector3(worldPos.x, Math.max(0.02, worldPos.y), worldPos.z);
    this.turfSpraySystem.manualEmitCount = count;
  }

  public applyAtmosphere(preset: LightingPreset, tier: QualityTier): void {
    this.lightingPreset = preset;
    this.qualityTier = tier;

    if (preset === 'daylight') {
      this.scene.clearColor = new Color4(0.56, 0.74, 0.92, 1.0);
      this.hemiLight.intensity = 1.15;
      this.mainSunLight.intensity = 2.8;
      this.mainSunLight.diffuse = Color3.FromHexString('#FFF9EE');
      for (const s of this.floodSpotLights) {
        s.intensity = 0.0;
      }
    } else {
      // Hero evening floodlights over Uddingston Night sky
      this.scene.clearColor = Color4.FromHexString(`${UDDINGSTON_COLOURS.NIGHT}FF`);
      this.hemiLight.intensity = 0.52;
      this.mainSunLight.intensity = 1.85;
      this.mainSunLight.diffuse = Color3.FromHexString('#EAF2FF');
      for (const s of this.floodSpotLights) {
        s.intensity = tier === 'showcase' ? 2.1 : 1.3;
      }
    }

    if (this.pipeline) {
      this.pipeline.dispose();
      this.pipeline = null;
    }

    if (tier === 'showcase') {
      this.pipeline = new DefaultRenderingPipeline('uddy_pipeline', true, this.scene, this.scene.cameras);
      this.pipeline.fxaaEnabled = true;
      this.pipeline.bloomEnabled = true;
      this.pipeline.bloomThreshold = 0.78;
      this.pipeline.bloomWeight = 0.25;
      this.pipeline.imageProcessingEnabled = true;
      this.pipeline.imageProcessing.toneMappingEnabled = true;
      this.pipeline.imageProcessing.contrast = 1.12;
      this.pipeline.imageProcessing.exposure = 1.05;
      if (this.shadowGenerator) {
        this.shadowGenerator.getShadowMap()!.refreshRate = 1;
      }
    } else if (this.shadowGenerator) {
      this.shadowGenerator.getShadowMap()!.refreshRate = 2;
    }
  }
}
