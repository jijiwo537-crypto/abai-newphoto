
import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react';

interface ViewfinderProps {
  video: HTMLVideoElement | null;
  lutUrl: string;
  exposure: number;
  kelvin: number;
  isUserFacing: boolean;
  onClick?: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
}

const VS_SOURCE = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
    gl_Position = vec4(a_position, 0, 1);
    v_texCoord = a_texCoord;
}
`;

const FS_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_video;
uniform sampler2D u_lut;
uniform bool u_useLut;
uniform float u_exposure;
uniform float u_kelvin;
uniform bool u_isUserFacing;
in vec2 v_texCoord;
out vec4 outColor;

vec3 applyKelvin(vec3 rgb, float kelvin) {
    float temp = (kelvin - 5000.0) / 5000.0;
    return rgb + vec3(temp * 0.0975, 0.0, -temp * 0.0975);
}

void main() {
    vec2 tc = v_texCoord;
    if (u_isUserFacing) tc.x = 1.0 - tc.x;
    
    vec4 source = texture(u_video, tc);
    vec3 rgb = source.rgb;

    // Manual Adjustments
    rgb *= pow(2.0, u_exposure);
    rgb = applyKelvin(rgb, u_kelvin);

    rgb = clamp(rgb, 0.0, 1.0);

    if (u_useLut) {
        float size = 64.0;
        float b = rgb.b * (size - 1.0);
        
        float z1 = floor(b);
        float z2 = ceil(b);
        
        vec2 q1;
        q1.y = floor(z1 / 8.0);
        q1.x = z1 - (q1.y * 8.0);
        
        vec2 q2;
        q2.y = floor(z2 / 8.0);
        q2.x = z2 - (q2.y * 8.0);
        
        vec2 p1;
        p1.x = (q1.x * size + 0.5 + rgb.r * (size - 1.0)) / 512.0;
        p1.y = (q1.y * size + 0.5 + rgb.g * (size - 1.0)) / 512.0;
        
        vec2 p2;
        p2.x = (q2.x * size + 0.5 + rgb.r * (size - 1.0)) / 512.0;
        p2.y = (q2.y * size + 0.5 + rgb.g * (size - 1.0)) / 512.0;
        
        vec3 c1 = texture(u_lut, p1).rgb;
        vec3 c2 = texture(u_lut, p2).rgb;
        
        rgb = mix(c1, c2, fract(b));
    }

    outColor = vec4(rgb, 1.0);
}
`;

export const Viewfinder = forwardRef(({ video, lutUrl, exposure, kelvin, isUserFacing, onClick }: ViewfinderProps, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const videoTexRef = useRef<WebGLTexture | null>(null);
  const lutTexRef = useRef<WebGLTexture | null>(null);
  const [lutLoaded, setLutLoaded] = useState(false);

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
  }));

  // Initialize WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false });
    if (!gl) return;
    glRef.current = gl;

    const createShader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };

    const prog = gl.createProgram()!;
    gl.attachShader(prog, createShader(gl.VERTEX_SHADER, VS_SOURCE));
    gl.attachShader(prog, createShader(gl.FRAGMENT_SHADER, FS_SOURCE));
    gl.linkProgram(prog);
    progRef.current = prog;

    const pos = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const uvs = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    const aUv = gl.getAttribLocation(prog, 'a_texCoord');
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    videoTexRef.current = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexRef.current);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return () => {
      // Cleanup
      gl.deleteProgram(prog);
      gl.deleteTexture(videoTexRef.current);
    };
  }, []);

  // Render Loop
  useEffect(() => {
    if (!glRef.current || !progRef.current) return;
    
    let rafId: number;
    const gl = glRef.current;
    const prog = progRef.current;

    const tick = () => {
      if (video && video.readyState >= 2) {
        if (canvasRef.current && (canvasRef.current.width !== video.videoWidth)) {
          canvasRef.current.width = video.videoWidth;
          canvasRef.current.height = video.videoHeight;
        }
        
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.useProgram(prog);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, videoTexRef.current);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        gl.uniform1i(gl.getUniformLocation(prog, 'u_video'), 0);

        const useLut = !!lutUrl && lutLoaded && !!lutTexRef.current;
        gl.uniform1i(gl.getUniformLocation(prog, 'u_useLut'), useLut ? 1 : 0);
        gl.uniform1f(gl.getUniformLocation(prog, 'u_exposure'), exposure);
        gl.uniform1f(gl.getUniformLocation(prog, 'u_kelvin'), kelvin);
        
        gl.uniform1i(gl.getUniformLocation(prog, 'u_isUserFacing'), isUserFacing ? 1 : 0);

        if (useLut) {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, lutTexRef.current);
          gl.uniform1i(gl.getUniformLocation(prog, 'u_lut'), 1);
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      rafId = requestAnimationFrame(tick);
    };
    
    tick();
    return () => cancelAnimationFrame(rafId);
  }, [video, exposure, kelvin, isUserFacing, lutUrl, lutLoaded]);

  // Handle LUT Loading
  useEffect(() => {
    if (!lutUrl || !glRef.current) {
      setLutLoaded(false);
      lutTexRef.current = null;
      return;
    }
    
    setLutLoaded(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const gl = glRef.current!;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      lutTexRef.current = tex;
      setLutLoaded(true);
    };
    img.src = lutUrl;
  }, [lutUrl]);

  return (
    <div className="w-full h-full relative" onClick={onClick}>
        <canvas ref={canvasRef} className="w-full h-full object-cover block" />
    </div>
  );
});
