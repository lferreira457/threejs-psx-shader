import * as THREE from 'three';

/**
 * Per-material PS1 effects, ported from PS1AffineFog.shader in
 * Math-Man/URP-PSX-FORKED. Instead of asking you to switch to a custom
 * material, these effects are injected into the materials you already
 * use (Basic / Lambert / Phong / Standard) through onBeforeCompile:
 *
 *   - Vertex snapping: after projection, vertices are rounded to the
 *     virtual screen grid. That's the trembling, popping polygon motion
 *     PS1 games had; the console had no sub-pixel precision.
 *     (Unity original: clipPos.xy = floor(clipPos.xy * snap + 0.5) / snap)
 *
 *   - Affine texture mapping: PS1 rasterizers interpolated UVs in screen
 *     space without perspective correction, which makes textures bend
 *     and swim on polygons seen at an angle. Emulated by interpolating
 *     uv*w and dividing by interpolated w in the fragment shader.
 *     (Unity original: the `noperspective` interpolation qualifier)
 *
 * Raw affine mapping is unbounded: the distortion of a triangle grows
 * with the ratio between its vertices' w values, so a big wall or floor
 * polygon right in front of the camera (ratios of 20x and more) makes
 * textures stretch and swim violently as the camera moves. PS1 games
 * fought this by heavily tessellating their geometry. This emulation
 * stays stable on modern meshes by constraining the effect in the
 * fragment shader:
 *
 *   1. The affine UV is computed classically (uv*w / w), then its
 *      *deviation* from the perspective-correct UV is clamped to
 *      affineCap (in UV units). The warp keeps its character but can
 *      never slide a texture more than a fraction of a tile.
 *   2. The deviation fades out for fragments closer than affineFade view
 *      units (using true per-fragment depth), so walking right up to a
 *      wall or looking down at the ground stays stable.
 *
 * The snap grid resolution lives in a shared global uniform which
 * PSXPipeline keeps in sync with its internal render target, so polygon
 * jitter always lands on real virtual pixels.
 */

export const psxGlobals = {
  uniforms: {
    uPsxSnapRes: { value: new THREE.Vector2( 320, 240 ) },
    uPsxSnapEnabled: { value: 1 },
    uPsxJitterScale: { value: 1 },   // >1 = coarser grid = wobblier
    uPsxAffineGlobal: { value: 1 },  // master affine amount, 0..1
    uPsxAffineCap: { value: 0.1 },   // max UV deviation from correct mapping
    uPsxAffineFade: { value: 2.5 },  // view distance where the warp is fully applied
  },
};

/** Globally enable/disable vertex snapping for every patched material. */
export function setVertexSnapEnabled( enabled ) {
  psxGlobals.uniforms.uPsxSnapEnabled.value = enabled ? 1 : 0;
}

/** Coarseness multiplier for the snap grid (1 = one virtual pixel). */
export function setJitterScale( scale ) {
  psxGlobals.uniforms.uPsxJitterScale.value = Math.max( scale, 0.05 );
}

/** Master multiplier (0..1) over every material's affine amount. */
export function setAffineAmount( amount ) {
  psxGlobals.uniforms.uPsxAffineGlobal.value = amount;
}

/**
 * Maximum distance (in UV units) the affine warp may shift a texture away
 * from its perspective-correct position. Keeps large triangles under
 * control.
 */
export function setAffineCap( uvUnits ) {
  psxGlobals.uniforms.uPsxAffineCap.value = Math.max( uvUnits, 0 );
}

/**
 * View distance over which the warp fades in. Fragments closer than
 * roughly half this distance get fully perspective-correct mapping;
 * this is what keeps close-up walls and floors from swimming.
 */
export function setAffineFade( distance ) {
  psxGlobals.uniforms.uPsxAffineFade.value = Math.max( distance, 0.01 );
}

/**
 * Patch a material with PSX vertex snapping and affine texture mapping.
 *
 * @param {THREE.Material} material  any built-in material
 * Works with MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial
 * and MeshStandardMaterial. Large flat surfaces behave best subdivided
 * into triangles of roughly 2 m, which is also what PS1 games did.
 *
 * @param {Object} opts
 * @param {boolean} opts.snap    enable vertex snapping (default true)
 * @param {number}  opts.affine  0..1 blend from perspective-correct to
 *                               fully affine UVs (default 0.75)
 * @returns the same material, for chaining
 */
export function applyPSXMaterial( material, opts = {} ) {

  const snap = opts.snap !== undefined ? opts.snap : true;
  const affine = opts.affine !== undefined ? opts.affine : 0.75;

  material.onBeforeCompile = ( shader ) => {

    shader.uniforms.uPsxSnapRes = psxGlobals.uniforms.uPsxSnapRes;
    shader.uniforms.uPsxSnapEnabled = psxGlobals.uniforms.uPsxSnapEnabled;
    shader.uniforms.uPsxJitterScale = psxGlobals.uniforms.uPsxJitterScale;
    shader.uniforms.uPsxAffineGlobal = psxGlobals.uniforms.uPsxAffineGlobal;
    shader.uniforms.uPsxAffineCap = psxGlobals.uniforms.uPsxAffineCap;
    shader.uniforms.uPsxAffineFade = psxGlobals.uniforms.uPsxAffineFade;
    shader.uniforms.uPsxAffine = { value: affine };

    shader.vertexShader = shader.vertexShader
      .replace( '#include <common>', /* glsl */ `
        #include <common>
        uniform vec2 uPsxSnapRes;
        uniform float uPsxSnapEnabled;
        uniform float uPsxJitterScale;
        varying float vPsxW;
        #ifdef USE_MAP
          varying vec2 vPsxAffineUv;
        #endif
      ` )
      .replace( '#include <project_vertex>', /* glsl */ `
        #include <project_vertex>
        #ifdef PSX_SNAP
          if ( uPsxSnapEnabled > 0.5 ) {
            vec2 psxGrid = ( uPsxSnapRes / max( uPsxJitterScale, 0.05 ) ) * 0.5;
            vec3 psxNdc = gl_Position.xyz / gl_Position.w;
            psxNdc.xy = floor( psxNdc.xy * psxGrid + 0.5 ) / psxGrid;
            gl_Position.xyz = psxNdc * gl_Position.w;
          }
        #endif
        // vPsxW is perspective-interpolated, so in the fragment shader it
        // equals the true view depth; dividing vPsxAffineUv by it yields
        // the classic screen-linear (affine) UV.
        vPsxW = gl_Position.w;
        #ifdef USE_MAP
          vPsxAffineUv = vMapUv * gl_Position.w;
        #endif
      ` );

    shader.fragmentShader = shader.fragmentShader
      .replace( '#include <common>', /* glsl */ `
        #include <common>
        uniform float uPsxAffine;
        uniform float uPsxAffineGlobal;
        uniform float uPsxAffineCap;
        uniform float uPsxAffineFade;
        varying float vPsxW;
        #ifdef USE_MAP
          varying vec2 vPsxAffineUv;
        #endif
      ` )
      .replace( '#include <map_fragment>', /* glsl */ `
        #ifdef USE_MAP
          // classic affine UV, then bound its deviation from the correct
          // mapping and fade it out near the camera (see header comment)
          vec2 psxDev = vPsxAffineUv / vPsxW - vMapUv;
          psxDev = clamp( psxDev, vec2( -uPsxAffineCap ), vec2( uPsxAffineCap ) );
          float psxNear = smoothstep( uPsxAffineFade * 0.5, uPsxAffineFade * 1.5, vPsxW );
          vec2 psxUv = vMapUv + psxDev * ( uPsxAffine * uPsxAffineGlobal * psxNear );
          vec4 sampledDiffuseColor = texture2D( map, psxUv );
          diffuseColor *= sampledDiffuseColor;
        #endif
      ` );

    if ( snap ) {
      shader.defines = shader.defines || {};
      shader.defines.PSX_SNAP = '';
    }
  };

  // materials sharing a base class but different PSX options must not
  // share a compiled program
  material.customProgramCacheKey = () => `psx_${ snap ? 1 : 0 }_${ affine }`;

  return material;
}
