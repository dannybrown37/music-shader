/** Thin WebGL2 helpers: programs with auto-typed uniforms, render targets, a fullscreen triangle. */

export type UniformValue = number | boolean | ArrayLike<number> | WebGLTexture;

const FULLSCREEN_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export class ShaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShaderError";
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new ShaderError(`${label}: could not create shader`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // Scene sources start with `#line 1`, so reported line numbers match the scene's .glsl file.
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new ShaderError(`${label}: ${log}`);
  }
  return shader;
}

interface UniformInfo {
  location: WebGLUniformLocation;
  type: number;
  size: number;
  unit: number;
}

export class Program {
  readonly gl: WebGL2RenderingContext;
  readonly program: WebGLProgram;
  readonly uniforms = new Map<string, UniformInfo>();

  constructor(gl: WebGL2RenderingContext, fragmentSource: string, label: string) {
    this.gl = gl;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VS, `${label} (vertex)`));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource, label));
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new ShaderError(`${label}: link failed: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    let unit = 0;
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, "");
      const location = gl.getUniformLocation(program, info.name);
      if (!location) continue;
      const isSampler = info.type === gl.SAMPLER_2D;
      this.uniforms.set(name, { location, type: info.type, size: info.size, unit: isSampler ? unit++ : -1 });
    }
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  has(name: string): boolean {
    return this.uniforms.has(name);
  }

  /** Silently ignores names the shader doesn't use, so scenes only pay for what they read. */
  set(name: string, value: UniformValue): void {
    const u = this.uniforms.get(name);
    if (!u) return;
    const gl = this.gl;
    if (u.type === gl.SAMPLER_2D) {
      gl.activeTexture(gl.TEXTURE0 + u.unit);
      gl.bindTexture(gl.TEXTURE_2D, value as WebGLTexture);
      gl.uniform1i(u.location, u.unit);
      return;
    }
    const v = typeof value === "number" ? [value] : typeof value === "boolean" ? [value ? 1 : 0] : (value as ArrayLike<number>);
    const arr = v instanceof Float32Array ? v : Float32Array.from(v as ArrayLike<number>);
    switch (u.type) {
      case gl.FLOAT:
        gl.uniform1fv(u.location, arr);
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(u.location, arr);
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(u.location, arr);
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(u.location, arr);
        break;
      case gl.INT:
      case gl.BOOL:
        gl.uniform1i(u.location, arr[0]);
        break;
      default:
        throw new TypeError(`uniform ${name}: unsupported type 0x${u.type.toString(16)}`);
    }
  }

  setAll(values: Record<string, UniformValue>): void {
    for (const name in values) this.set(name, values[name]);
  }
}

export interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, hdr: boolean): Target {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, hdr ? gl.RGBA16F : gl.RGBA8, width, height, 0, gl.RGBA, hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, width, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target): void {
  gl.deleteTexture(t.texture);
  gl.deleteFramebuffer(t.framebuffer);
}

/** Single-channel float data texture (spectrum, spectrogram). R16F is filterable everywhere WebGL2 runs. */
export class DataTexture {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
  private readonly gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, width, height, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  upload(data: Float32Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RED, gl.FLOAT, data);
  }
}

export class FullscreenTriangle {
  private readonly vao: WebGLVertexArrayObject;
  private readonly gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  draw(target: Target | null, viewport?: [number, number]): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    const [w, h] = target ? [target.width, target.height] : (viewport ?? [gl.drawingBufferWidth, gl.drawingBufferHeight]);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
