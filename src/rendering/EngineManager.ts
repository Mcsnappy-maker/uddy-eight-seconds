import {
  AbstractEngine,
  Engine,
  WebGPUEngine,
} from '@babylonjs/core';

export type RendererBackend = 'webgpu' | 'webgl2';
export type QualityTier = 'showcase' | 'balanced' | 'compatible';
export type LightingPreset = 'floodlit' | 'daylight';

export interface EngineInitResult {
  engine: AbstractEngine;
  backend: RendererBackend;
  fallbackReason: string | null;
  gpuAdapterInfo: string;
}

export class EngineManager {
  public static getRequestedBackend(): RendererBackend | 'auto' {
    const param = new URLSearchParams(window.location.search).get('renderer');
    if (param === 'webgl2') return 'webgl2';
    if (param === 'webgpu') return 'webgpu';
    return 'auto';
  }

  public static async createEngine(
    canvas: HTMLCanvasElement,
    forcedBackend?: RendererBackend | 'auto',
  ): Promise<EngineInitResult> {
    const preference = forcedBackend ?? EngineManager.getRequestedBackend();
    let fallbackReason: string | null = null;

    if (preference !== 'webgl2') {
      try {
        const supported = await WebGPUEngine.IsSupportedAsync;
        if (supported) {
          const webgpu = new WebGPUEngine(canvas, {
            antialias: true,
            powerPreference: 'high-performance',
            adaptToDeviceRatio: true,
          });
          await webgpu.initAsync();
          const info = (webgpu as unknown as { _adapterInfo?: { vendor?: string; architecture?: string; description?: string; device?: string } })._adapterInfo;
          const adapterLabel = info
            ? [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' / ') || 'WebGPU Adapter'
            : 'WebGPU Adapter';
          return {
            engine: webgpu,
            backend: 'webgpu',
            fallbackReason: null,
            gpuAdapterInfo: adapterLabel,
          };
        }
        fallbackReason = 'WebGPU API/adapter not supported in this browser context';
      } catch (err) {
        fallbackReason = err instanceof Error ? err.message : String(err);
      }
    } else {
      fallbackReason = 'WebGL2 explicitly selected (?renderer=webgl2 or toggle)';
    }

    const webgl2 = new Engine(
      canvas,
      true,
      {
        antialias: true,
        powerPreference: 'high-performance',
        stencil: true,
        preserveDrawingBuffer: false,
      },
      true,
    );

    let glRenderer = 'WebGL2 Adapter';
    try {
      const gl = (webgl2 as unknown as { _gl?: WebGL2RenderingContext })._gl;
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          glRenderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
        } else {
          glRenderer = String(gl.getParameter(gl.RENDERER));
        }
      }
    } catch {
      // Ignore query failures
    }

    return {
      engine: webgl2,
      backend: 'webgl2',
      fallbackReason,
      gpuAdapterInfo: glRenderer,
    };
  }
}
