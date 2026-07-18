import * as THREE from 'three';

/**
 * A minimal fullscreen triangle used to run post-processing passes.
 * Kept internal so the package has no dependency on three/addons.
 */

export const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 1.0, 1.0 );
}
`;

export class FullScreenQuad {

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute( 'position', new THREE.BufferAttribute(
      new Float32Array( [ -1, -1, 0, 3, -1, 0, -1, 3, 0 ] ), 3 ) );
    geo.setAttribute( 'uv', new THREE.BufferAttribute(
      new Float32Array( [ 0, 0, 2, 0, 0, 2 ] ), 2 ) );

    this._mesh = new THREE.Mesh( geo );
    this._mesh.frustumCulled = false;
    this._scene = new THREE.Scene();
    this._scene.add( this._mesh );
    this._camera = new THREE.OrthographicCamera();
  }

  /** Draw `material` over the whole current render target. */
  render( renderer, material ) {
    this._mesh.material = material;
    renderer.render( this._scene, this._camera );
  }

  dispose() {
    this._mesh.geometry.dispose();
  }
}
