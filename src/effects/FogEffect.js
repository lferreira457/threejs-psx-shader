import * as THREE from 'three';
import { PSXEffect } from '../PSXEffect.js';

/**
 * Screen-space fog with animated noise.
 *
 * Port of Fog.shader from Math-Man/URP-PSX-FORKED: reads the scene depth,
 * blends towards a fog color with an exponential falloff, and modulates
 * the fog amount with slowly drifting noise so it reads as volume rather
 * than a flat gradient.
 *
 * This pass runs in linear color space, before gamma encoding, so it
 * blends exactly the same way Three.js scene fog does. It also works
 * *with* scene fog rather than replacing it: a common setup is
 * `scene.fog` for the base fade plus this effect for the animated layer
 * on top.
 *
 * Setting scene.background to the same color hides the world's edges,
 * which is what lets a small scene with a short draw distance read as
 * a large one.
 *
 * Settings:
 *   color          fog color (match your scene fog / background)
 *   density        exponential density, higher = thicker
 *   offset         distance in front of the camera where fog starts
 *   noiseScale     size of the noise pattern
 *   noiseSpeed     drift speed
 *   noiseStrength  0 = plain smooth fog, 1 = very patchy
 */

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec3 uColor;
uniform float uDensity;
uniform float uOffset;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uNoiseStrength;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform vec2 uLowRes;

float hash21( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}

float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = hash21( i );
  float b = hash21( i + vec2( 1.0, 0.0 ) );
  float c = hash21( i + vec2( 0.0, 1.0 ) );
  float d = hash21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}

float fbm( vec2 p ) {
  return vnoise( p ) * 0.62 + vnoise( p * 2.37 + 17.7 ) * 0.38;
}

void main() {
  vec4 c = texture2D( tDiffuse, vUv );

  float depth = texture2D( tDepth, vUv ).x;
  // perspective depth -> positive view-space distance
  float viewZ = ( uNear * uFar ) / ( ( uFar - uNear ) * depth - uFar );
  float dist = -viewZ;

  float fog = 1.0 - exp( -uDensity * max( dist - uOffset, 0.0 ) );

  vec2 np = vUv * vec2( uLowRes.x / uLowRes.y, 1.0 ) * uNoiseScale;
  np += vec2( uTime * uNoiseSpeed, uTime * uNoiseSpeed * 0.37 );
  float n = fbm( np ) - 0.5;
  fog = clamp( fog * ( 1.0 + n * uNoiseStrength * 2.0 ), 0.0, 1.0 );

  gl_FragColor = vec4( mix( c.rgb, uColor, fog ), c.a );
}
`;

export class FogEffect extends PSXEffect {

  constructor( settings = {} ) {
    super( 'fog', 'linear', FRAGMENT, {
      tDepth: { value: null },
      uColor: { value: new THREE.Color( '#8f949c' ) },
      uDensity: { value: 0.03 },
      uOffset: { value: 5 },
      uNoiseScale: { value: 4 },
      uNoiseSpeed: { value: 0.1 },
      uNoiseStrength: { value: 0.4 },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uTime: { value: 0 },
      uLowRes: { value: new THREE.Vector2( 320, 240 ) },
    } );

    this.settings = {
      color: '#8f949c',
      density: 0.03,
      offset: 5,
      noiseScale: 4,
      noiseSpeed: 0.1,
      noiseStrength: 0.4,
      ...settings,
    };
  }

  updateUniforms( ctx ) {
    const s = this.settings;
    const u = this.material.uniforms;
    u.tDepth.value = ctx.tDepth;
    u.uColor.value.set( s.color );
    u.uDensity.value = s.density;
    u.uOffset.value = s.offset;
    u.uNoiseScale.value = s.noiseScale;
    u.uNoiseSpeed.value = s.noiseSpeed;
    u.uNoiseStrength.value = s.noiseStrength;
    u.uNear.value = ctx.camera.near;
    u.uFar.value = ctx.camera.far;
    u.uTime.value = ctx.time;
    u.uLowRes.value.copy( ctx.lowRes );
  }
}
