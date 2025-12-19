import { useEffect, useRef } from 'react';
import './BoidsLoader.css';

// Simple Boids-based loader animation, inspired by
// https://vanhunteradams.com/Pico/Animal_Movement/Boids_Lab.html
// Separation, alignment, cohesion, plus a loose screen bounding box.

export const BoidsLoader = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };

    resize();
    window.addEventListener('resize', resize);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = () => canvas.width;
    const height = () => canvas.height;

    // 3D Boids: we keep a z dimension and project to 2D
    // Loader flock size – very dense murmuration
    const numBoids = 1200;

    // 3D world parameters
    const worldDepth = 800 * dpr; // z from 0 (near) to worldDepth (far)
    const cameraZ = -400 * dpr;   // camera in front of z=0, looking toward +z
    const fov = 500 * dpr;        // affects perspective strength

    const boids = [];
    for (let i = 0; i < numBoids; i++) {
      // Start scattered randomly in a 3D volume centered on the camera view,
      // so the murmuration feels like a distant cloud of speckles.
      const scatterX = width() * 0.8;   // +/- 40% of width
      const scatterY = height() * 0.8;  // +/- 40% of height
      const startZMin = worldDepth * 0.2;
      const startZMax = worldDepth * 0.9;

      boids.push({
        x: (Math.random() - 0.5) * scatterX,
        y: (Math.random() - 0.5) * scatterY,
        z: startZMin + Math.random() * (startZMax - startZMin),
        vx: (Math.random() * 2 - 1) * 1.5,
        vy: (Math.random() * 2 - 1) * 1.5,
        vz: (Math.random() * 2 - 1) * 1.5,
      });
    }

    // Parameters (classic boids, biased toward strong cohesion)
    const visualRange = 160 * dpr;      // see neighbors a bit farther away
    const protectedRange = 24 * dpr;    // small personal bubble
    const centeringFactor = 0.0032;     // very strong pull toward center of mass
    const avoidFactor = 0.02;           // gentler separation, so flock stays dense
    const matchingFactor = 0.12;        // strong velocity matching for smooth flow
    const maxSpeed = 4 * dpr;
    const minSpeed = 0.6 * dpr;
    const turnFactor = 0.2;

    let animationFrameId;

    const step = () => {
      const w = width();
      const h = height();

      // Update boids according to rules (in 3D)
      for (let i = 0; i < numBoids; i++) {
        const b = boids[i];

        let closeDx = 0;
        let closeDy = 0;
        let closeDz = 0;
        let centerX = 0;
        let centerY = 0;
        let centerZ = 0;
        let avgVx = 0;
        let avgVy = 0;
        let avgVz = 0;
        let neighborCount = 0;

        for (let j = 0; j < numBoids; j++) {
          if (i === j) continue;
          const other = boids[j];
          const dx = other.x - b.x;
          const dy = other.y - b.y;
          const dz = other.z - b.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq < visualRange * visualRange) {
            neighborCount++;
            centerX += other.x;
            centerY += other.y;
            centerZ += other.z;
            avgVx += other.vx;
            avgVy += other.vy;
            avgVz += other.vz;

            if (distSq < protectedRange * protectedRange) {
              closeDx -= dx;
              closeDy -= dy;
              closeDz -= dz;
            }
          }
        }

        // Separation
        b.vx += closeDx * avoidFactor;
        b.vy += closeDy * avoidFactor;
        b.vz += closeDz * avoidFactor;

        if (neighborCount > 0) {
          // Cohesion
          centerX /= neighborCount;
          centerY /= neighborCount;
          centerZ /= neighborCount;
          b.vx += (centerX - b.x) * centeringFactor;
          b.vy += (centerY - b.y) * centeringFactor;
          b.vz += (centerZ - b.z) * centeringFactor;

          // Alignment
          avgVx /= neighborCount;
          avgVy /= neighborCount;
          avgVz /= neighborCount;
          b.vx += (avgVx - b.vx) * matchingFactor;
          b.vy += (avgVy - b.vy) * matchingFactor;
          b.vz += (avgVz - b.vz) * matchingFactor;
        }

        // Boundaries (soft box)
        const margin = 80 * dpr;
        if (b.x < -w / 2 + margin) b.vx += turnFactor;
        if (b.x > w / 2 - margin) b.vx -= turnFactor;
        if (b.y < -h / 2 + margin) b.vy += turnFactor;
        if (b.y > h / 2 - margin) b.vy -= turnFactor;
        if (b.z < margin) b.vz += turnFactor;
        if (b.z > worldDepth - margin) b.vz -= turnFactor;

        // Clamp speed
        let speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
        if (speed < minSpeed) {
          const s = speed || 1;
          b.vx = (b.vx / s) * minSpeed;
          b.vy = (b.vy / s) * minSpeed;
          b.vz = (b.vz / s) * minSpeed;
        } else if (speed > maxSpeed) {
          b.vx = (b.vx / speed) * maxSpeed;
          b.vy = (b.vy / speed) * maxSpeed;
          b.vz = (b.vz / speed) * maxSpeed;
        }

        // Integrate
        b.x += b.vx;
        b.y += b.vy;
        b.z += b.vz;
      }

      // Draw
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);

      // Centered 3D projection
      const cx = w / 2;
      const cy = h / 2;

      for (let i = 0; i < numBoids; i++) {
        const b = boids[i];

        // Simple perspective projection
        const zRel = b.z - cameraZ; // distance from camera
        if (zRel <= 0) continue; // behind camera

        const scale = fov / zRel;
        const x2d = cx + b.x * scale;
        const y2d = cy + b.y * scale;

        // Skip if projected offscreen
        if (x2d < -50 || x2d > w + 50 || y2d < -50 || y2d > h + 50) continue;

        // Base size in screen space - very small speckles
        const baseSize = 0.9 * dpr * scale; // farther boids are tiny specks

        // Velocity angle for trailing circles
        const vx2d = b.vx;
        const vy2d = b.vy;
        const angle = Math.atan2(vy2d, vx2d);

        // Flicker factor per boid per frame
        const flicker = 0.85 + Math.random() * 0.3; // 0.85–1.15

        // Depth-based alpha – closer boids are darker
        const depthFade = Math.max(0.15, Math.min(1, 1 - b.z / worldDepth));
        const baseAlpha = 0.75 * depthFade * flicker;

        // Color: neutral gray
        const color = (alpha) => `rgba(80,80,80,${alpha})`;

        // Draw three circles: one lead, two trailing
        const drawCircle = (offset, radius, alpha) => {
          const ox = x2d + Math.cos(angle) * offset;
          const oy = y2d + Math.sin(angle) * offset;
          ctx.beginPath();
          ctx.arc(ox, oy, Math.max(radius, 0.4), 0, Math.PI * 2);
          ctx.fillStyle = color(alpha);
          ctx.fill();
        };

        const mainRadius = baseSize;
        const trailRadius1 = baseSize * 0.7;
        const trailRadius2 = baseSize * 0.45;

        // Lead circle (front)
        drawCircle(0, mainRadius, baseAlpha);
        // Two trailing circles slightly behind along velocity
        drawCircle(-mainRadius * 0.8, trailRadius1, baseAlpha * 0.7);
        drawCircle(-mainRadius * 1.5, trailRadius2, baseAlpha * 0.45);
      }

      animationFrameId = requestAnimationFrame(step);
    };

    animationFrameId = requestAnimationFrame(step);

    return () => {
      window.removeEventListener('resize', resize);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="boids-loader">
      <canvas ref={canvasRef} className="boids-loader-canvas" />
    </div>
  );
};


