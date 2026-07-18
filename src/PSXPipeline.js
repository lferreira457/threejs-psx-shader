import * as THREE from 'three';
import { FullScreenQuad, FULLSCREEN_VERTEX_SHADER } from './FullScreenQuad.js';
import { psxGlobals } from './PSXMaterial.js';
import { PixelationEffect } from './effects/PixelationEffect.js';
import { DitheringEffect } from './effects/DitheringEffect.js';
import { FogEffect } from './effects/FogEffect.js';
import { CRTEffect } from './effects/CRTEffect.js';

/**
 * PSXPipeline
 * -----------
 * Renders your scene the way a PS1 would have: into a small internal
 * frame buffer (320x240 by default) which is then pushed through a chain
 * of post-processing effects and finally stretched to the real canvas
 * with nearest-neighbour sampling. The hard pixel edges you see are real:
 * the scene genuinely renders at that resolution.
 *
 * Think of it as the Three.js equivalent of the URP renderer features in
 * Math-Man/URP-PSX-FORKED: each effect lives in its own file under
 * `effects/`, has its own shader, and can be enabled, disabled, reordered
 * or left out entirely.
 *
 * Basic use:
 *
 *   const psx = new PSXPipeline(renderer, scene, camera);
 *   psx.setSize(innerWidth, innerHeight);
 *   psx.render(deltaTime);              // instead of renderer.render()
 *
 *   psx.getEffect('fog').settings.density = 0.08;
 *   psx.getEffect('crt').enabled = false;
 *
 * Or hand-pick the chain:
 *
 *   const psx = new PSXPipeline(renderer, scene, camera, {
 *     effects: [ new PixelationEffect({ resolutionHeight: 180 }),
 *                new DitheringEffect({ pattern: 'bayer' }) ],
 *   });
 *
 * How the chain runs each frame:
 *
 *   1. scene  ->  low-res buffer (with a depth texture)
 *   2. 'linear'  effects: run before gamma encoding (fog lives here so
 *                it blends the same way scene fog does)
 *   3. gamma encode: from here on colors are display values, which is
 *                exactly where dithering and color crushing belong
 *   4. 'display' effects: dithering, color precision, ...
 *   5. 'output' effect: drawn straight to the canvas at full window
 *                resolution (the CRT pass), or a plain nearest-neighbour
 *                upscale if no output effect is enabled
 */

const ENCODE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
vec3 toSRGB( vec3 c ) {
  c = clamp( c, 0.0, 1.0 );
  return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
}
void main() {
  vec4 t = texture2D( tDiffuse, vUv );
  gl_FragColor = vec4( toSRGB( t.rgb ), t.a );
}
`;

const COPY_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
void main() {
  gl_FragColor = texture2D( tDiffuse, vUv );
}
`;

function makeTarget( w, h, withDepth ) {
  const rt = new THREE.WebGLRenderTarget( w, h, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.HalfFloatType,
    depthBuffer: withDepth,
  } );
  rt.texture.generateMipmaps = false;
  if ( withDepth ) rt.depthTexture = new THREE.DepthTexture( w, h );
  return rt;
}

export class PSXPipeline {

  constructor( renderer, scene, camera, options = {} ) {

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;
    this.time = 0;

    this.effects = options.effects ?? [
      new FogEffect(),
      new DitheringEffect(),
      new PixelationEffect( { resolutionHeight: options.resolutionHeight ?? 240 } ),
      new CRTEffect(),
    ];

    this._quad = new FullScreenQuad();
    this._rtScene = makeTarget( 320, 240, true );
    this._ping = [ makeTarget( 320, 240, false ), makeTarget( 320, 240, false ) ];
    this._pingIndex = 0;

    this._encodeMaterial = new THREE.ShaderMaterial( {
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: ENCODE_FRAGMENT,
      depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null } },
    } );
    this._copyMaterial = new THREE.ShaderMaterial( {
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: COPY_FRAGMENT,
      depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null } },
    } );

    this._outputSize = new THREE.Vector2( 1, 1 );
    this._lowRes = new THREE.Vector2( 320, 240 );
    this.setSize( renderer.domElement.width, renderer.domElement.height );
  }

  /** Find an effect by its name ('fog', 'dithering', 'pixelation', 'crt'). */
  getEffect( name ) {
    return this.effects.find( ( e ) => e.name === name ) ?? null;
  }

  setSize( width, height ) {
    this._outputSize.set( width, height );
    this._applyResolution();
  }

  _applyResolution() {
    const out = this._outputSize;
    const pix = this.getEffect( 'pixelation' );
    let rw = out.x, rh = out.y;
    if ( pix && pix.enabled && pix.settings.pixelate ) {
      rh = Math.max( 64, Math.round( pix.settings.resolutionHeight ) );
      rw = Math.max( 64, Math.round( rh * ( out.x / out.y ) ) );
    }
    if ( this._rtScene.width !== rw || this._rtScene.height !== rh ) {
      this._rtScene.setSize( rw, rh );
      this._ping[ 0 ].setSize( rw, rh );
      this._ping[ 1 ].setSize( rw, rh );
    }
    this._lowRes.set( rw, rh );
    // keep the vertex-snap grid of PSX materials on the same virtual pixels
    psxGlobals.uniforms.uPsxSnapRes.value.set( rw, rh );
  }

  _next() {
    this._pingIndex ^= 1;
    return this._ping[ this._pingIndex ];
  }

  render( deltaTime = 0.016 ) {
    this.time += deltaTime;
    const renderer = this.renderer;

    if ( !this.enabled ) {
      renderer.setRenderTarget( null );
      renderer.render( this.scene, this.camera );
      return;
    }

    this._applyResolution();

    // 1. scene into the low-res buffer
    renderer.setRenderTarget( this._rtScene );
    renderer.render( this.scene, this.camera );

    const ctx = {
      time: this.time,
      camera: this.camera,
      lowRes: this._lowRes,
      outRes: this._outputSize,
      tDepth: this._rtScene.depthTexture,
      getEffect: ( n ) => this.getEffect( n ),
    };

    let read = this._rtScene.texture;

    // 2. linear-space effects
    for ( const e of this.effects ) {
      if ( !e.enabled || e.space !== 'linear' ) continue;
      const target = this._next();
      e.render( renderer, this._quad, ctx, read, target );
      read = target.texture;
    }

    // 3. gamma encode
    {
      const target = this._next();
      this._encodeMaterial.uniforms.tDiffuse.value = read;
      renderer.setRenderTarget( target );
      this._quad.render( renderer, this._encodeMaterial );
      read = target.texture;
    }

    // 4. display-space effects
    for ( const e of this.effects ) {
      if ( !e.enabled || e.space !== 'display' ) continue;
      const target = this._next();
      e.render( renderer, this._quad, ctx, read, target );
      read = target.texture;
    }

    // 5. output: last enabled output-space effect draws to the canvas,
    //    otherwise a plain nearest-neighbour upscale
    const output = [ ...this.effects ].reverse()
      .find( ( e ) => e.enabled && e.space === 'output' );
    if ( output ) {
      output.render( renderer, this._quad, ctx, read, null );
    } else {
      this._copyMaterial.uniforms.tDiffuse.value = read;
      renderer.setRenderTarget( null );
      this._quad.render( renderer, this._copyMaterial );
    }
  }

  dispose() {
    this._rtScene.dispose();
    this._ping[ 0 ].dispose();
    this._ping[ 1 ].dispose();
    this._encodeMaterial.dispose();
    this._copyMaterial.dispose();
    this._quad.dispose();
    for ( const e of this.effects ) e.dispose();
  }
}
