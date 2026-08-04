import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export const ThreeBackground: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Create Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.012);

    // 2. Create Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 25;

    // 3. WebGL Renderer with Ultra Settings
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // 4. Dramatic Contrast Studio Lighting (Specular Gloss Design)
    const ambientLight = new THREE.AmbientLight(0x060606);
    scene.add(ambientLight);

    // High intensity Key Light (cool white)
    const keyLight = new THREE.DirectionalLight(0xffffff, 4.0);
    keyLight.position.set(20, 25, 20);
    scene.add(keyLight);

    // High contrast Fill Light (warm neutral white)
    const fillLight = new THREE.DirectionalLight(0xddeeff, 2.0);
    fillLight.position.set(-20, -10, -10);
    scene.add(fillLight);

    // Intense Rim Light for sharp metallic edges
    const rimLight = new THREE.DirectionalLight(0xffffff, 3.5);
    rimLight.position.set(0, -30, -15);
    scene.add(rimLight);

    // Self-Guided Point Light that orbits smoothly for dynamic reflection highlights
    const pointLight = new THREE.PointLight(0xffffff, 5.0, 50);
    pointLight.position.set(0, 0, 10);
    scene.add(pointLight);

    // 5. Build Upgraded Masterpiece: Nested Camera Aperture / Chrono Ring System
    // Object A: Central Reflective Obsidian Crystal Core (Icosahedron)
    const coreGeometry = new THREE.IcosahedronGeometry(4.8, 4);
    const originalPositions = coreGeometry.attributes.position.clone();

    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x070707,
      roughness: 0.1,
      metalness: 0.98,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      reflectivity: 1.0,
      envMapIntensity: 2.5,
    });

    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    scene.add(coreMesh);

    // Fine wireframe overlay with highly sophisticated structure
    const coreWireframeGeom = new THREE.IcosahedronGeometry(4.82, 2);
    const coreWireframeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.06,
    });
    const coreWireframeMesh = new THREE.Mesh(coreWireframeGeom, coreWireframeMat);
    coreMesh.add(coreWireframeMesh);

    // Object B: Multi-layer concentric Camera Aperture Focus Rings
    const ringGroup = new THREE.Group();
    scene.add(ringGroup);

    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.15,
      metalness: 0.95,
    });

    // Ring 1: Wide outer guide track
    const ringGeom1 = new THREE.TorusGeometry(8.2, 0.04, 16, 120);
    const ring1 = new THREE.Mesh(ringGeom1, ringMaterial);
    ring1.rotation.x = Math.PI / 4;
    ringGroup.add(ring1);

    // Ring 2: Perpendicular inner track
    const ringGeom2 = new THREE.TorusGeometry(7.0, 0.04, 16, 120);
    const ring2 = new THREE.Mesh(ringGeom2, ringMaterial);
    ring2.rotation.y = Math.PI / 3;
    ringGroup.add(ring2);

    // Ring 3: Center focus bevel ring
    const ringGeom3 = new THREE.TorusGeometry(5.8, 0.06, 16, 120);
    const ring3 = new THREE.Mesh(ringGeom3, ringMaterial);
    ring3.rotation.z = Math.PI / 6;
    ringGroup.add(ring3);

    // Node pointers on the ring (representing f-stop tick marks and aperture pointers)
    const nodeGeometry = new THREE.SphereGeometry(0.12, 16, 16);
    const nodeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
    });

    // Distribute small nodes along the focus rings
    const nodeCount = 5;
    for (let i = 0; i < nodeCount; i++) {
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
      const angle = (i / nodeCount) * Math.PI * 2;
      node.position.set(Math.cos(angle) * 8.2, Math.sin(angle) * 8.2, 0);
      ring1.add(node);
    }

    for (let i = 0; i < 4; i++) {
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      node.position.set(Math.cos(angle) * 7.0, Math.sin(angle) * 7.0, 0);
      ring2.add(node);
    }

    // 6. Responsive Resizing
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      }
    });
    resizeObserver.observe(container);

    // 7. Kinetic/Self-Guided Animation Logic
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const time = clock.getElapsedTime();

      // Rotating complex ring structures on independent, interlocking axes.
      ring1.rotation.z = time * 0.18;
      ring2.rotation.x = -time * 0.22;
      ring3.rotation.y = time * 0.12;

      coreMesh.rotation.y = time * 0.08;
      coreMesh.rotation.x = time * 0.05;

      // High-end breathing scale animation (sculpture alive state)
      const breathe = Math.sin(time * 0.6) * 0.04 + 1.0;
      coreMesh.scale.set(breathe, breathe, breathe);

      // Liquid Chrome morphing wave effect on Obsidian Core
      const posAttr = coreGeometry.attributes.position;
      const origAttr = originalPositions;
      const tempV = new THREE.Vector3();
      const origV = new THREE.Vector3();

      for (let i = 0; i < posAttr.count; i++) {
        origV.fromBufferAttribute(origAttr, i);
        
        // Multi-frequency wave formula
        const wave1 = Math.sin(origV.x * 0.35 + time * 1.5);
        const wave2 = Math.cos(origV.y * 0.35 + time * 1.8);
        const wave3 = Math.sin(origV.z * 0.25 + time * 1.2);
        
        const amplitude = 0.18;
        const displacement = (wave1 + wave2 + wave3) * amplitude;
        
        tempV.copy(origV).normalize().multiplyScalar(displacement);
        
        posAttr.setXYZ(
          i,
          origV.x + tempV.x,
          origV.y + tempV.y,
          origV.z + tempV.z
        );
      }

      posAttr.needsUpdate = true;
      coreGeometry.computeVertexNormals();

      // Mirror subtle variations onto the wireframe mesh
      const wfPosAttr = coreWireframeMesh.geometry.attributes.position;
      for (let i = 0; i < wfPosAttr.count; i++) {
        wfPosAttr.setXYZ(
          i,
          posAttr.getX(i) * 1.002,
          posAttr.getY(i) * 1.002,
          posAttr.getZ(i) * 1.002
        );
      }
      wfPosAttr.needsUpdate = true;

      // Self-orbiting point light
      pointLight.position.x = Math.sin(time * 1.4) * 14;
      pointLight.position.y = Math.cos(time * 1.2) * 14;
      pointLight.position.z = Math.sin(time * 0.8) * 5 + 12;

      renderer.render(scene, camera);
    };

    animate();

    // 8. Thorough Memory Safe Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      
      coreGeometry.dispose();
      originalPositions.clone(); // triggers clean GC release
      coreMaterial.dispose();
      
      coreWireframeGeom.dispose();
      coreWireframeMat.dispose();
      
      ringGeom1.dispose();
      ringGeom2.dispose();
      ringGeom3.dispose();
      ringMaterial.dispose();
      
      nodeGeometry.dispose();
      nodeMaterial.dispose();
      
      renderer.dispose();
      
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div 
      ref={containerRef} 
      className="absolute inset-0 w-full h-full pointer-events-none select-none z-0"
      style={{ background: 'radial-gradient(circle at center, #090909 0%, #000000 100%)' }}
    />
  );
};
