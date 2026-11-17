// Lightweight self-contained WebGL2 3D viewer for Gridfinity meshes and print beds

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;

uniform mat4 uMvp;
uniform mat4 uModel;

out vec3 vNormal;
out vec3 vWorldPos;

void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uMvp * vec4(aPos, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorldPos;

uniform vec3 uColor;
uniform vec3 uCameraPos;
uniform float uAlpha;

out vec4 outColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorldPos);

  vec3 L1 = normalize(vec3(0.45, -0.55, 0.85));
  vec3 L2 = normalize(vec3(-0.6, 0.4, 0.35));
  vec3 L3 = normalize(vec3(-0.35, 0.5, -0.8));

  float diff1 = max(dot(N, L1), 0.0);
  float diff2 = max(dot(N, L2), 0.0);
  float diff3 = max(dot(N, L3), 0.0);

  vec3 H = normalize(L1 + V);
  float spec = pow(max(dot(N, H), 0.0), 36.0) * 0.22;

  // Subtle ambient occlusion based on height to make socket walls crisp
  float ao = 0.78 + 0.22 * clamp(vWorldPos.z / 5.0, 0.0, 1.0);

  vec3 lit = uColor * (0.32 + 0.60 * diff1 + 0.24 * diff2 + 0.42 * diff3) * ao + vec3(spec);
  outColor = vec4(lit, uAlpha);
}
`;

const LINE_VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uMvp;
void main() {
  gl_Position = uMvp * vec4(aPos, 1.0);
}
`;

const LINE_FRAG_SRC = `#version 300 es
precision highp float;
uniform vec4 uLineColor;
out vec4 outColor;
void main() {
  outColor = uLineColor;
}
`;

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || 'Shader compile error');
  }
  return s;
}

function createProgram(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'Program link error');
  }
  return p;
}

function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function mat4Perspective(fovyRad, aspect, near, far) {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len;
  zy /= len;
  zz /= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len;
  xy /= len;
  xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const m = new Float32Array(16);
  m[0] = xx; m[4] = xy; m[8] = xz;
  m[1] = yx; m[5] = yy; m[9] = yz;
  m[2] = zx; m[6] = zy; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

function mat4TransformZ(tx, ty, tz, turnsCCW) {
  const m = mat4Identity();
  const angle = (turnsCCW * Math.PI) / 2;
  const c = Math.round(Math.cos(angle));
  const s = Math.round(Math.sin(angle));
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  return m;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16 & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Viewer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
    if (!this.gl) {
      this.supported = false;
      return;
    }
    this.supported = true;

    const gl = this.gl;
    this.meshProg = createProgram(gl, VERT_SRC, FRAG_SRC);
    this.lineProg = createProgram(gl, LINE_VERT_SRC, LINE_FRAG_SRC);

    this.uMvp = gl.getUniformLocation(this.meshProg, 'uMvp');
    this.uModel = gl.getUniformLocation(this.meshProg, 'uModel');
    this.uColor = gl.getUniformLocation(this.meshProg, 'uColor');
    this.uCameraPos = gl.getUniformLocation(this.meshProg, 'uCameraPos');
    this.uAlpha = gl.getUniformLocation(this.meshProg, 'uAlpha');

    this.uLineMvp = gl.getUniformLocation(this.lineProg, 'uMvp');
    this.uLineColor = gl.getUniformLocation(this.lineProg, 'uLineColor');

    this.meshItems = [];
    this.lineBuffers = [];

    // Camera spherical coords (Z-up)
    this.target = [0, 0, 2];
    this.yaw = -Math.PI * 0.35;
    this.pitch = 0.85;
    this.distance = 450;

    this.bindEvents();
    this.resize();
  }

  bindEvents() {
    let dragging = false;
    let panMode = false;
    let lastX = 0;
    let lastY = 0;

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      panMode = e.button === 2 || e.shiftKey;
      lastX = e.clientX;
      lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (panMode) {
        const scale = this.distance * 0.0014;
        const rightX = -Math.sin(this.yaw);
        const rightY = Math.cos(this.yaw);
        const fwdX = Math.cos(this.yaw);
        const fwdY = Math.sin(this.yaw);
        this.target[0] -= (rightX * dx - fwdX * dy) * scale;
        this.target[1] -= (rightY * dx - fwdY * dy) * scale;
      } else {
        this.yaw -= dx * 0.007;
        this.pitch = Math.max(-Math.PI * 0.49, Math.min(Math.PI * 0.49, this.pitch - dy * 0.007));
      }
      this.render();
    });

    const endDrag = () => {
      dragging = false;
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = Math.exp(e.deltaY * 0.001);
        this.distance = Math.max(40, Math.min(2500, this.distance * factor));
        this.render();
      },
      { passive: false }
    );
  }

  resize() {
    if (!this.supported) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    this.render();
  }

  clearScene() {
    if (!this.supported) return;
    const gl = this.gl;
    for (const item of this.meshItems) {
      gl.deleteBuffer(item.posBuf);
      gl.deleteBuffer(item.normBuf);
      gl.deleteVertexArray(item.vao);
    }
    for (const lb of this.lineBuffers) {
      gl.deleteBuffer(lb.buf);
      gl.deleteVertexArray(lb.vao);
    }
    this.meshItems = [];
    this.lineBuffers = [];
  }

  uploadMesh(mesh) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    return { vao, posBuf, normBuf, vertCount: mesh.triCount * 3 };
  }

  addLineSegments(points, color) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.lineBuffers.push({ vao, buf, vertCount: points.length / 3, color });
  }

  setSceneDrawer(plan, modelMeshes, colors, highlightModelIndex = -1, resetCam = false) {
    if (!this.supported) return;
    this.clearScene();

    // Upload one GPU mesh per unique model, then reuse across tiles
    const gpuByKey = new Map();
    for (const m of plan.models) {
      const gpu = this.uploadMesh(modelMeshes.get(m.key));
      gpuByKey.set(m.key, { gpu, modelIndex: m.index });
    }

    // Drawer interior boundary centered around (0, 0)
    const dw = plan.drawerWidthMm / 2;
    const dd = plan.drawerDepthMm / 2;
    const baseOffsetX = (plan.assemblyX ?? (plan.drawerWidthMm - plan.totalWidthMm) / 2) - dw;
    const baseOffsetY = (plan.assemblyY ?? (plan.drawerDepthMm - plan.totalDepthMm) / 2) - dd;

    for (const tile of plan.tiles) {
      const { gpu, modelIndex } = gpuByKey.get(tile.modelKey);
      const tx = baseOffsetX + tile.xMm + tile.widthMm / 2;
      const ty = baseOffsetY + tile.yMm + tile.depthMm / 2;
      const modelMat = mat4TransformZ(tx, ty, 0, tile.placeRotationCCW);
      const dimmed = highlightModelIndex !== -1 && highlightModelIndex !== modelIndex;
      this.meshItems.push({
        ...gpu,
        modelMat,
        color: hexToRgb(colors[modelIndex % colors.length]),
        alpha: dimmed ? 0.32 : 1.0,
      });
    }

    // Drawer interior boundary box outline
    const boxH = 24;
    const pts = [
      // Bottom rectangle
      -dw, -dd, 0,  dw, -dd, 0,
       dw, -dd, 0,  dw,  dd, 0,
       dw,  dd, 0, -dw,  dd, 0,
      -dw,  dd, 0, -dw, -dd, 0,
      // Top rim
      -dw, -dd, boxH,  dw, -dd, boxH,
       dw, -dd, boxH,  dw,  dd, boxH,
       dw,  dd, boxH, -dw,  dd, boxH,
      -dw,  dd, boxH, -dw, -dd, boxH,
      // Vertical posts
      -dw, -dd, 0, -dw, -dd, boxH,
       dw, -dd, 0,  dw, -dd, boxH,
       dw,  dd, 0,  dw,  dd, boxH,
      -dw,  dd, 0, -dw,  dd, boxH,
    ];
    this.addLineSegments(pts, [0.45, 0.52, 0.62, 0.7]);

    if (resetCam) {
      this.target = [0, 0, 2];
      this.distance = Math.max(plan.drawerWidthMm, plan.drawerDepthMm) * 1.35;
      this.yaw = -Math.PI * 0.32;
      this.pitch = 0.85;
    }
    this.render();
  }

  setSceneSingleBed(model, mesh, bedWidthMm, bedDepthMm, colorHex, resetCam = false) {
    if (!this.supported) return;
    this.clearScene();

    const gpu = this.uploadMesh(mesh);
    this.meshItems.push({
      ...gpu,
      modelMat: mat4Identity(),
      color: hexToRgb(colorHex),
      alpha: 1.0,
    });

    // Draw printer bed wireframe centered at (0, 0, 0)
    const hw = bedWidthMm / 2;
    const hd = bedDepthMm / 2;
    const outline = [
      -hw, -hd, 0,  hw, -hd, 0,
       hw, -hd, 0,  hw,  hd, 0,
       hw,  hd, 0, -hw,  hd, 0,
      -hw,  hd, 0, -hw, -hd, 0,
    ];
    this.addLineSegments(outline, [0.0, 0.72, 0.30, 0.95]);

    // Subtle 42mm grid lines on the bed
    const gridLines = [];
    for (let x = -Math.floor(hw / 42) * 42; x <= hw; x += 42) {
      gridLines.push(x, -hd, -0.05, x, hd, -0.05);
    }
    for (let y = -Math.floor(hd / 42) * 42; y <= hd; y += 42) {
      gridLines.push(-hw, y, -0.05, hw, y, -0.05);
    }
    this.addLineSegments(gridLines, [0.35, 0.42, 0.50, 0.35]);

    if (resetCam) {
      this.target = [0, 0, 2];
      this.distance = Math.max(bedWidthMm, bedDepthMm) * 1.35;
      this.yaw = -Math.PI * 0.32;
      this.pitch = 0.85;
    }
    this.render();
  }

  render() {
    if (!this.supported) return;
    const gl = this.gl;

    const isLight = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';
    if (isLight) {
      gl.clearColor(0.95, 0.96, 0.98, 1.0);
    } else {
      gl.clearColor(0.06, 0.08, 0.11, 1.0);
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = mat4Perspective((42 * Math.PI) / 180, aspect, 1, 8000);

    const cosP = Math.cos(this.pitch);
    const eye = [
      this.target[0] + this.distance * cosP * Math.cos(this.yaw),
      this.target[1] + this.distance * cosP * Math.sin(this.yaw),
      this.target[2] + this.distance * Math.sin(this.pitch),
    ];
    const view = mat4LookAt(eye, this.target, [0, 0, 1]);
    const vp = mat4Mul(proj, view);

    // Draw lines first
    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(this.uLineMvp, false, vp);
    for (const lb of this.lineBuffers) {
      gl.uniform4fv(this.uLineColor, lb.color);
      gl.bindVertexArray(lb.vao);
      gl.drawArrays(gl.LINES, 0, lb.vertCount);
    }

    // Draw meshes (opaque first, dimmed last)
    gl.useProgram(this.meshProg);
    gl.uniform3fv(this.uCameraPos, eye);

    const ordered = [...this.meshItems].sort((a, b) => b.alpha - a.alpha);
    for (const item of ordered) {
      const mvp = mat4Mul(vp, item.modelMat);
      gl.uniformMatrix4fv(this.uMvp, false, mvp);
      gl.uniformMatrix4fv(this.uModel, false, item.modelMat);
      gl.uniform3fv(this.uColor, item.color);
      gl.uniform1f(this.uAlpha, item.alpha);
      gl.bindVertexArray(item.vao);
      gl.drawArrays(gl.TRIANGLES, 0, item.vertCount);
    }

    gl.bindVertexArray(null);
  }
}
