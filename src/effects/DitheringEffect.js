import { PSXEffect } from '../PSXEffect.js';

/**
 * Ordered dithering.
 *
 * Port of Dithering.shader from Math-Man/URP-PSX-FORKED, including its
 * 4x4 patterns. Pattern 'psx' is the actual kernel the PS1 GPU used when
 * it dithered 24-bit colors down to 15-bit.
 *
 * Two modes:
 *
 *   'add'      (default) the authentic approach: the kernel nudges each
 *              pixel's color up or down before it gets truncated to the
 *              color steps, which turns banding into the familiar
 *              crosshatch. Runs against the color steps of the pixelation
 *              effect (or its own colorSteps if you set one).
 *
 *   'multiply' the approach the Unity project used: compare pixel
 *              brightness against the pattern and darken pixels that fall
 *              below it. Harsher, more stylized.
 *
 * Settings:
 *   pattern    'psx' | 'bayer' | 'checker' | 'grid' | 'none'
 *   mode       'add' | 'multiply'
 *   strength   dither intensity (1 = one full color step)
 *   scale      dither cell size in virtual pixels (2 = chunkier pattern)
 *   threshold  multiply mode only, brightness cutoff
 *   colorSteps null = follow the pixelation effect, or set a number
 */

const PATTERNS = { none: 0, psx: 1, bayer: 2, checker: 3, grid: 4 };
const MODES = { add: 0, multiply: 1 };

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform int uPattern;
uniform int uMode;
uniform float uStrength;
uniform float uScale;
uniform float uThreshold;
uniform float uLevels;

// the PS1 GPU's own dither kernel
const float PSX_KERNEL[ 16 ] = float[ 16 ](
  -4.0,  0.0, -3.0,  1.0,
   2.0, -2.0,  3.0, -1.0,
  -3.0,  1.0, -4.0,  0.0,
   3.0, -1.0,  2.0, -2.0
);

// classic 4x4 ordered Bayer matrix
const float BAYER4[ 16 ] = float[ 16 ](
   0.0,  8.0,  2.0, 10.0,
  12.0,  4.0, 14.0,  6.0,
   3.0, 11.0,  1.0,  9.0,
  15.0,  7.0, 13.0,  5.0
);

// x: signed offset in [-0.5, 0.5) for add mode
// y: threshold in [0, 1) for multiply mode
vec2 ditherValue( ivec2 cell ) {
  int idx = ( cell.y & 3 ) * 4 + ( cell.x & 3 );
  if ( uPattern == 1 ) {
    float v = PSX_KERNEL[ idx ];
    return vec2( v / 8.0, v / 8.0 + 0.5 );
  } else if ( uPattern == 2 ) {
    float v = ( BAYER4[ idx ] + 0.5 ) / 16.0;
    return vec2( v - 0.5, v );
  } else if ( uPattern == 3 ) {
    float v = mod( float( cell.x + cell.y ), 2.0 );
    return vec2( v * 0.5 - 0.25, v );
  } else if ( uPattern == 4 ) {
    float v = mod( float( cell.x ), 2.0 ) * mod( float( cell.y ), 2.0 );
    return vec2( v * 0.5 - 0.25, v );
  }
  return vec2( 0.0 );
}

void main() {
  vec4 c = texture2D( tDiffuse, vUv );
  if ( uPattern != 0 ) {
    ivec2 cell = ivec2( floor( gl_FragCoord.xy / max( uScale, 1.0 ) ) );
    vec2 dv = ditherValue( cell );

    if ( uMode == 0 ) {
      // nudge, then truncate to the color steps
      c.rgb = floor( c.rgb * uLevels + 0.5 + dv.x * uStrength ) / uLevels;
    } else {
      float brightness = ( c.r + c.g + c.b ) / 3.0;
      float keep = ( brightness * uThreshold ) < dv.y ? 1.0 - uStrength : 1.0;
      c.rgb *= clamp( keep, 0.0, 1.0 );
    }
  }
  gl_FragColor = c;
}
`;

export class DitheringEffect extends PSXEffect {

  constructor( settings = {} ) {
    super( 'dithering', 'display', FRAGMENT, {
      uPattern: { value: 1 },
      uMode: { value: 0 },
      uStrength: { value: 1 },
      uScale: { value: 1 },
      uThreshold: { value: 1 },
      uLevels: { value: 31 },
    } );

    this.settings = {
      pattern: 'psx',
      mode: 'add',
      strength: 1.0,
      scale: 1,
      threshold: 1.0,
      colorSteps: null,
      ...settings,
    };
  }

  updateUniforms( ctx ) {
    const s = this.settings;
    const u = this.material.uniforms;
    u.uPattern.value = PATTERNS[ s.pattern ] ?? 1;
    u.uMode.value = MODES[ s.mode ] ?? 0;
    u.uStrength.value = s.strength;
    u.uScale.value = s.scale;
    u.uThreshold.value = s.threshold;
    const steps = s.colorSteps
      ?? ctx.getEffect( 'pixelation' )?.settings.steps
      ?? 32;
    u.uLevels.value = Math.max( steps - 1, 1 );
  }
}
