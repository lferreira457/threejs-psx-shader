import * as THREE from 'three';
import { FULLSCREEN_VERTEX_SHADER } from './FullScreenQuad.js';

/**
 * Base class for every post-processing effect in the pipeline.
 *
 * An effect is a single fullscreen shader pass with:
 *   - `name`      a short id used to look it up on the pipeline
 *   - `space`     'linear'  = runs before gamma encoding (e.g. fog)
 *                 'display' = runs on display-ready color (e.g. dithering)
 *                 'output'  = runs last, at native resolution (e.g. CRT)
 *   - `enabled`   toggle at runtime, no cost when off
 *   - `settings`  a plain object you can change every frame; each effect
 *                 copies it into its shader uniforms before rendering
 *
 * To write your own effect, extend this class, provide a fragment shader
 * that reads `tDiffuse`, and override `updateUniforms(ctx)`. The `ctx`
 * object gives you: time, camera, lowRes, outRes, tDepth and
 * getEffect(name) for talking to other effects in the chain.
 */
export class PSXEffect {

  constructor( name, space, fragmentShader, uniforms = {} ) {
    this.name = name;
    this.space = space;
    this.enabled = true;

    this.material = new THREE.ShaderMaterial( {
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        ...uniforms,
      },
    } );
  }

  /** Override: copy this.settings into this.material.uniforms. */
  updateUniforms( /* ctx */ ) {}

  render( renderer, quad, ctx, inputTexture, outputTarget ) {
    this.material.uniforms.tDiffuse.value = inputTexture;
    this.updateUniforms( ctx );
    renderer.setRenderTarget( outputTarget );
    quad.render( renderer, this.material );
  }

  dispose() {
    this.material.dispose();
  }
}
