import * as THREE from 'three';
import { PSXEffect } from '../PSXEffect.js';

/**
 * CRT television pass.
 *
 * Port of CRTShader.shader from Math-Man/URP-PSX-FORKED: screen bend,
 * vignette, scanlines, animated grain, chromatic aberration and an RGB
 * grille. This is the last pass in the chain. It samples the low-res
 * image with nearest-neighbour filtering and draws straight to the
 * canvas at full window resolution, so scanlines and grille stay crisp
 * while the picture underneath stays chunky.
 *
 * The defaults aim for a subtle, well-adjusted CRT; raise the values for
 * a heavily worn look. Set bend to 0 for a flat screen. With the pass
 * disabled entirely, the pipeline falls back to a plain
 * nearest-neighbour upscale: pixelated image, no display simulation.
 *
 * Settings:
 *   bend               0 = flat, 6..12 = visible curvature
 *   vignetteAmount     corner darkening strength
 *   vignetteSize / vignetteRounding / vignetteSmoothing
 *   scanlineWeight     0 = off
 *   scanlineDensity    0.5 = one dark line every 2 virtual pixels
 *   scanlineSpeed      scrolling speed, 0 = static
 *   grainWeight        animated per-pixel noise
 *   chromatic          RGB fringe, measured in virtual pixels
 *   grilleOpacity      vertical RGB stripe mask (0 = off)
 */

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uLowRes;
uniform float uTime;
uniform float uBend;
uniform float uVignetteAmount;
uniform float uVignetteSize;
uniform float uVignetteRounding;
uniform float uVignetteSmoothing;
uniform float uScanlineWeight;
uniform float uScanlineDensity;
uniform float uScanlineSpeed;
uniform float uGrainWeight;
uniform float uChromatic;
uniform float uGrilleOpacity;

float hash21( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}

void main() {
  vec2 uv = vUv;

  // screen bend
  if ( uBend > 0.0 ) {
    vec2 cuv = uv * 2.0 - 1.0;
    float k = 1.0 / max( uBend, 0.0001 );
    cuv.x *= 1.0 + pow( abs( cuv.y ) * k, 2.0 );
    cuv.y *= 1.0 + pow( abs( cuv.x ) * k, 2.0 );
    uv = cuv * 0.5 + 0.5;
  }

  // outside the bent screen is the TV bezel
  if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) {
    gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
    return;
  }

  // chromatic aberration, offsets measured in virtual pixels
  vec3 col;
  if ( uChromatic > 0.0 ) {
    vec2 dir = ( uv - 0.5 ) * ( uChromatic / uLowRes );
    col = vec3(
      texture2D( tDiffuse, uv + dir ).r,
      texture2D( tDiffuse, uv ).g,
      texture2D( tDiffuse, uv - dir ).b
    );
  } else {
    col = texture2D( tDiffuse, uv ).rgb;
  }

  // scanlines
  if ( uScanlineWeight > 0.0 ) {
    float s = sin( uv.y * uLowRes.y * uScanlineDensity * 6.28318 + uTime * uScanlineSpeed );
    col *= 1.0 - uScanlineWeight * ( 0.5 + 0.5 * s );
  }

  // animated grain, one value per virtual pixel like tape noise
  if ( uGrainWeight > 0.0 ) {
    float g = hash21( floor( uv * uLowRes ) + vec2( fract( uTime * 13.7 ) * 371.0 ) );
    col += ( g - 0.5 ) * uGrainWeight;
  }

  // RGB grille on real output pixels
  if ( uGrilleOpacity > 0.0 ) {
    float m = mod( floor( gl_FragCoord.x ), 3.0 );
    vec3 grille = vec3( float( m == 0.0 ), float( m == 1.0 ), float( m == 2.0 ) );
    col = mix( col, col * ( 0.33 + grille ), uGrilleOpacity );
  }

  // vignette
  if ( uVignetteAmount > 0.0 ) {
    vec2 vg = ( uv - 0.5 ) * uVignetteSize;
    float v = 1.0 - sqrt( pow( abs( vg.x ), uVignetteRounding ) +
                          pow( abs( vg.y ), uVignetteRounding ) ) * uVignetteAmount;
    v = smoothstep( 0.0, uVignetteSmoothing, v );
    col *= v;
  }

  gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
}
`;

export class CRTEffect extends PSXEffect {

  constructor( settings = {} ) {
    super( 'crt', 'output', FRAGMENT, {
      uLowRes: { value: new THREE.Vector2( 320, 240 ) },
      uTime: { value: 0 },
      uBend: { value: 0 },
      uVignetteAmount: { value: 0.72 },
      uVignetteSize: { value: 1.1 },
      uVignetteRounding: { value: 2.6 },
      uVignetteSmoothing: { value: 0.7 },
      uScanlineWeight: { value: 0.1 },
      uScanlineDensity: { value: 0.5 },
      uScanlineSpeed: { value: 0 },
      uGrainWeight: { value: 0.06 },
      uChromatic: { value: 0.35 },
      uGrilleOpacity: { value: 0 },
    } );

    this.settings = {
      bend: 0,
      vignetteAmount: 0.72,
      vignetteSize: 1.1,
      vignetteRounding: 2.6,
      vignetteSmoothing: 0.7,
      scanlineWeight: 0.1,
      scanlineDensity: 0.5,
      scanlineSpeed: 0,
      grainWeight: 0.06,
      chromatic: 0.35,
      grilleOpacity: 0,
      ...settings,
    };
  }

  updateUniforms( ctx ) {
    const s = this.settings;
    const u = this.material.uniforms;
    u.uLowRes.value.copy( ctx.lowRes );
    u.uTime.value = ctx.time;
    u.uBend.value = s.bend;
    u.uVignetteAmount.value = s.vignetteAmount;
    u.uVignetteSize.value = s.vignetteSize;
    u.uVignetteRounding.value = s.vignetteRounding;
    u.uVignetteSmoothing.value = s.vignetteSmoothing;
    u.uScanlineWeight.value = s.scanlineWeight;
    u.uScanlineDensity.value = s.scanlineDensity;
    u.uScanlineSpeed.value = s.scanlineSpeed;
    u.uGrainWeight.value = s.grainWeight;
    u.uChromatic.value = s.chromatic;
    u.uGrilleOpacity.value = s.grilleOpacity;
  }
}
