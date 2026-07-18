import { PSXEffect } from '../PSXEffect.js';

/**
 * Pixelation + color precision.
 *
 * Port of Pixelation.shader from Math-Man/URP-PSX-FORKED, which crushed
 * the image resolution by snapping UVs and reduced color precision with
 * floor(color * precision) / precision.
 *
 * Two differences worth knowing about:
 *
 *   - Resolution reduction is not done by snapping UVs. Instead, this
 *     effect tells the pipeline what size the internal render target
 *     should be, so the scene actually renders at e.g. 320x240 and
 *     polygon edges come out genuinely jagged.
 *
 *   - Color crushing runs on display (gamma) values, which matches how
 *     the console truncated its 8-bit values down to 5 bits per channel.
 *
 * Settings:
 *   pixelate          true/false, drives the low-res render target
 *   resolutionHeight  virtual vertical resolution (240 = PS1-like);
 *                     width follows the window's aspect ratio
 *   colorCrush        true/false, quantizes colors
 *   steps             color levels per channel (32 = the PS1's 15-bit look)
 */

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uLevels; // steps - 1, or 0 to skip

void main() {
  vec4 c = texture2D( tDiffuse, vUv );
  if ( uLevels >= 1.0 ) {
    c.rgb = floor( c.rgb * uLevels + 0.5 ) / uLevels;
  }
  gl_FragColor = c;
}
`;

export class PixelationEffect extends PSXEffect {

  constructor( settings = {} ) {
    super( 'pixelation', 'display', FRAGMENT, {
      uLevels: { value: 31 },
    } );

    this.settings = {
      pixelate: true,
      resolutionHeight: 240,
      colorCrush: true,
      steps: 32,
      ...settings,
    };
  }

  updateUniforms() {
    const s = this.settings;
    this.material.uniforms.uLevels.value = s.colorCrush ? s.steps - 1 : 0;
  }
}
