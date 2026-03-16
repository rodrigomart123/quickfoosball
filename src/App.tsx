import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics, useBox, useSphere, useCompoundBody } from '@react-three/cannon';
import * as THREE from 'three';
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

// --- Socket ---
const socket: Socket = io();

// --- Global State for CPU ---
export const globalBallPos = new THREE.Vector3();
export const globalBallVel = new THREE.Vector3();

// --- Types ---
type GameMode = '1v1' | '2v2' | '3v3' | 'solo';
type Player = { id: string, name: string, team: 1 | 2, role: number };

// --- Store ---
interface GameState {
  lobbyState: 'menu' | 'lobby' | 'playing' | 'gameover';
  mode: GameMode;
  roomId: string;
  players: Player[];
  myId: string;
  isHost: boolean;
  score1: number;
  score2: number;
  winner: number | null;
  resetVotes: number;
  resetTrigger: number;
  cameraMode: number;
  highlightTrigger: number;
  chat: { sender: string, text: string }[];
  setGameState: (state: Partial<GameState>) => void;
  triggerReset: () => void;
}

const useGameStore = create<GameState>((set) => ({
  lobbyState: 'menu',
  mode: '1v1',
  roomId: '',
  players: [],
  myId: '',
  isHost: false,
  score1: 0,
  score2: 0,
  winner: null,
  resetVotes: 0,
  resetTrigger: 0,
  cameraMode: 0,
  highlightTrigger: 0,
  chat: [],
  setGameState: (state) => set((prev) => ({ ...prev, ...state })),
  triggerReset: () => set((state) => ({ resetTrigger: state.resetTrigger + 1 }))
}));

// --- Helpers ---
function doesPlayerControlRod(mode: GameMode, team: 1 | 2, role: number, rodIndex: number): boolean {
  const isT1 = team === 1;
  const isT2 = team === 2;
  
  if (mode === '1v1' || mode === 'solo') return true;
  
  if (mode === '2v2') {
    if (role === 0) {
      if (isT1 && (rodIndex === 0 || rodIndex === 1)) return true;
      if (isT2 && (rodIndex === 7 || rodIndex === 6)) return true;
    }
    if (role === 1) {
      if (isT1 && (rodIndex === 3 || rodIndex === 5)) return true;
      if (isT2 && (rodIndex === 4 || rodIndex === 2)) return true;
    }
  }
  
  if (mode === '3v3') {
    if (role === 0) {
      if (isT1 && (rodIndex === 0 || rodIndex === 1)) return true;
      if (isT2 && (rodIndex === 7 || rodIndex === 6)) return true;
    }
    if (role === 1) {
      if (isT1 && rodIndex === 3) return true;
      if (isT2 && rodIndex === 4) return true;
    }
    if (role === 2) {
      if (isT1 && rodIndex === 5) return true;
      if (isT2 && rodIndex === 2) return true;
    }
  }
  
  return false;
}

// --- Controls ---
export const keys: Record<string, boolean> = {
  w: false, s: false, a: false, d: false, e: false, E: false,
  ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false
};

const KeyboardController = () => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture keys if typing in chat
      if (document.activeElement?.tagName === 'INPUT') return;
      
      if (e.code === 'Space' && useGameStore.getState().lobbyState === 'playing') {
        socket.emit('vote_reset', { roomId: useGameStore.getState().roomId });
      }
      if (e.key === '0' && useGameStore.getState().lobbyState === 'playing') {
        useGameStore.setState(state => ({ cameraMode: (state.cameraMode + 1) % 3 }));
      }
      if (e.key === '1' && useGameStore.getState().lobbyState === 'playing') {
        useGameStore.setState(state => ({ highlightTrigger: state.highlightTrigger + 1 }));
      }
      if (keys.hasOwnProperty(e.key)) keys[e.key] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (keys.hasOwnProperty(e.key)) keys[e.key] = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  return null;
};

// --- Components ---

const Field = () => {
  const [ref] = useBox(() => ({ type: 'Static', args: [25.0, 1, 16], position: [0, -1.7, 0] }));
  const [corner1] = useBox(() => ({ type: 'Static', args: [1.5, 1, 5.5], position: [-13.25, -1.7, -5.25] }));
  const [corner2] = useBox(() => ({ type: 'Static', args: [1.5, 1, 5.5], position: [-13.25, -1.7, 5.25] }));
  const [corner3] = useBox(() => ({ type: 'Static', args: [1.5, 1, 5.5], position: [13.25, -1.7, -5.25] }));
  const [corner4] = useBox(() => ({ type: 'Static', args: [1.5, 1, 5.5], position: [13.25, -1.7, 5.25] }));

  return (
    <group>
      <mesh ref={ref as any} receiveShadow>
        <boxGeometry args={[25.0, 1, 16]} />
        <meshStandardMaterial color="#2e7d32" />
      </mesh>
      <mesh ref={corner1 as any} receiveShadow><boxGeometry args={[1.5, 1, 5.5]} /><meshStandardMaterial color="#2e7d32" /></mesh>
      <mesh ref={corner2 as any} receiveShadow><boxGeometry args={[1.5, 1, 5.5]} /><meshStandardMaterial color="#2e7d32" /></mesh>
      <mesh ref={corner3 as any} receiveShadow><boxGeometry args={[1.5, 1, 5.5]} /><meshStandardMaterial color="#2e7d32" /></mesh>
      <mesh ref={corner4 as any} receiveShadow><boxGeometry args={[1.5, 1, 5.5]} /><meshStandardMaterial color="#2e7d32" /></mesh>
      
      {/* Goal Holes Visuals */}
      <mesh position={[-13.25, -2.0, 0]} receiveShadow>
        <boxGeometry args={[1.5, 0.5, 5]} />
        <meshStandardMaterial color="#000000" />
      </mesh>
      <mesh position={[13.25, -2.0, 0]} receiveShadow>
        <boxGeometry args={[1.5, 0.5, 5]} />
        <meshStandardMaterial color="#000000" />
      </mesh>

      {/* Center Line */}
      <mesh position={[0, -1.19, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[0.2, 14]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {/* Center Circle */}
      <mesh position={[0, -1.19, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[1.9, 2.1, 32]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {/* P1 Penalty Area */}
      <mesh position={[-10.5, -1.19, 4]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4, 0.2]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[-10.5, -1.19, -4]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4, 0.2]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[-8.5, -1.19, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[0.2, 8.2]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {/* P2 Penalty Area */}
      <mesh position={[10.5, -1.19, 4]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4, 0.2]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[10.5, -1.19, -4]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4, 0.2]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[8.5, -1.19, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[0.2, 8.2]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  );
};

const Wall = ({ position, args }: { position: [number, number, number], args: [number, number, number] }) => {
  const [ref] = useBox(() => ({ type: 'Static', args, position }));
  return (
    <mesh ref={ref as any} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color="#1b5e20" />
    </mesh>
  );
};

const SlopedCorner = ({ position, rotationY }: { position: [number, number, number], rotationY: number }) => {
  const [ref] = useBox(() => ({
    type: 'Static',
    args: [4, 2, 4],
    position,
    rotation: [0, rotationY, 0]
  }));
  return (
    <mesh ref={ref as any} receiveShadow>
      <boxGeometry args={[4, 2, 4]} />
      <meshStandardMaterial color="#1b5e20" />
    </mesh>
  );
};

const InvisibleCeiling = () => {
  const [ref] = useBox(() => ({ type: 'Static', args: [100, 2, 100], position: [0, 10.0, 0] }));
  return (
    <mesh ref={ref as any} visible={false}>
      <boxGeometry args={[100, 2, 100]} />
    </mesh>
  );
};

const InvisibleBoundaries = () => {
  const [ref1] = useBox(() => ({ type: 'Static', args: [30, 20, 2], position: [0, 5, -8.0] })); 
  const [ref2] = useBox(() => ({ type: 'Static', args: [30, 20, 2], position: [0, 5, 8.0] }));  
  const [ref3] = useBox(() => ({ type: 'Static', args: [2, 20, 20], position: [-14.5, 5, 0] }));  
  const [ref4] = useBox(() => ({ type: 'Static', args: [2, 20, 20], position: [14.5, 5, 0] }));  
  
  // Above the side walls near the goal to prevent getting stuck on top of them
  const [ref5] = useBox(() => ({ type: 'Static', args: [2, 20, 5], position: [-13.0, 5, -5] }));
  const [ref6] = useBox(() => ({ type: 'Static', args: [2, 20, 5], position: [-13.0, 5, 5] }));
  const [ref7] = useBox(() => ({ type: 'Static', args: [2, 20, 5], position: [13.0, 5, -5] }));
  const [ref8] = useBox(() => ({ type: 'Static', args: [2, 20, 5], position: [13.0, 5, 5] }));

  return (
    <group>
      <mesh ref={ref1 as any} visible={false}><boxGeometry args={[30, 20, 2]} /></mesh>
      <mesh ref={ref2 as any} visible={false}><boxGeometry args={[30, 20, 2]} /></mesh>
      <mesh ref={ref3 as any} visible={false}><boxGeometry args={[2, 20, 20]} /></mesh>
      <mesh ref={ref4 as any} visible={false}><boxGeometry args={[2, 20, 20]} /></mesh>
      <mesh ref={ref5 as any} visible={false}><boxGeometry args={[2, 20, 5]} /></mesh>
      <mesh ref={ref6 as any} visible={false}><boxGeometry args={[2, 20, 5]} /></mesh>
      <mesh ref={ref7 as any} visible={false}><boxGeometry args={[2, 20, 5]} /></mesh>
      <mesh ref={ref8 as any} visible={false}><boxGeometry args={[2, 20, 5]} /></mesh>
    </group>
  );
};

const Table = () => {
  return (
    <group>
      <Field />
      <InvisibleCeiling />
      <InvisibleBoundaries />
      <Wall position={[0, -0.7, -7.5]} args={[26, 2, 1]} />
      <Wall position={[0, -0.7, 7.5]} args={[26, 2, 1]} />
      
      <Wall position={[-13.0, -0.7, -4.75]} args={[1, 2, 4.5]} />
      <Wall position={[-13.0, -0.7, 4.75]} args={[1, 2, 4.5]} />
      <Wall position={[-14.0, -0.7, 0]} args={[1, 2, 5]} />
      <Wall position={[-13.25, -0.7, -2.5]} args={[1.5, 2, 1]} />
      <Wall position={[-13.25, -0.7, 2.5]} args={[1.5, 2, 1]} />
      
      <Wall position={[13.0, -0.7, -4.75]} args={[1, 2, 4.5]} />
      <Wall position={[13.0, -0.7, 4.75]} args={[1, 2, 4.5]} />
      <Wall position={[14.0, -0.7, 0]} args={[1, 2, 5]} />
      <Wall position={[13.25, -0.7, -2.5]} args={[1.5, 2, 1]} />
      <Wall position={[13.25, -0.7, 2.5]} args={[1.5, 2, 1]} />

      <SlopedCorner position={[-13.0, -0.7, -7.5]} rotationY={Math.PI / 4} />
      <SlopedCorner position={[13.0, -0.7, -7.5]} rotationY={Math.PI / 4} />
      <SlopedCorner position={[-13.0, -0.7, 7.5]} rotationY={Math.PI / 4} />
      <SlopedCorner position={[13.0, -0.7, 7.5]} rotationY={Math.PI / 4} />
    </group>
  );
};

const Ball = () => {
  const { isHost, roomId, resetTrigger, players, myId } = useGameStore();
  const myPlayer = players.find(p => p.id === myId);
  const isPlayer1 = myPlayer ? myPlayer.team === 1 : true;
  
  const [ref, api] = useSphere(() => ({
    mass: 1,
    args: [0.4],
    position: [0, 1, 0],
    material: { restitution: 0.8, friction: 0.05 }
  }));
  
  const pos = useRef([0,0,0]);
  const vel = useRef([0,0,0]);
  const isResetting = useRef(false);

  useEffect(() => {
    const unsubPos = api.position.subscribe(p => {
      pos.current = p;
      globalBallPos.set(p[0], p[1], p[2]);
    });
    const unsubVel = api.velocity.subscribe(v => {
      vel.current = v;
      globalBallVel.set(v[0], v[1], v[2]);
    });
    return () => { unsubPos(); unsubVel(); };
  }, [api]);

  useEffect(() => {
    const handleBallSync = (data: { position: number[], velocity: number[] }) => {
      if (!isHost) {
        api.position.set(data.position[0], data.position[1], data.position[2]);
        api.velocity.set(data.velocity[0], data.velocity[1], data.velocity[2]);
      }
    };
    socket.on('ball_sync', handleBallSync);
    return () => { socket.off('ball_sync', handleBallSync); };
  }, [isHost, api]);

  useEffect(() => {
    api.position.set(0, 1, 0);
    api.velocity.set((Math.random() - 0.5) * 15, 0, (Math.random() - 0.5) * 15);
    api.angularVelocity.set(0, 0, 0);
  }, [resetTrigger, api]);

  const vec = new THREE.Vector3();
  const target = new THREE.Vector3();

  useFrame((state) => {
    const { cameraMode } = useGameStore.getState();
    const zOffset = isPlayer1 ? 6 : -6;
    
    if (cameraMode === 0) {
      // Follow ball
      target.set(pos.current[0] * 0.4, 0, pos.current[2] * 0.4);
      vec.set(pos.current[0] * 0.4, 18, pos.current[2] * 0.4 + zOffset);
    } else if (cameraMode === 1) {
      // Focus on my players (center of the table, angled towards my side)
      target.set(0, 0, 0);
      vec.set(isPlayer1 ? -4 : 4, 15, zOffset * 2);
    } else {
      // Static top-down
      target.set(0, 0, 0);
      vec.set(0, 25, 0);
    }
    
    state.camera.position.lerp(vec, 0.05);
    state.camera.lookAt(target);

    if (isHost) {
      if (isResetting.current && Math.abs(pos.current[0]) < 5 && Math.abs(pos.current[2]) < 5) {
        isResetting.current = false;
      }

      // Velocity clamp and minimum speed boost
      const maxVel = 55;
      const v = vel.current;
      const speedSq = v[0]*v[0] + v[1]*v[1] + v[2]*v[2];
      
      if (speedSq > maxVel * maxVel) {
        const speed = Math.sqrt(speedSq);
        api.velocity.set((v[0]/speed)*maxVel, (v[1]/speed)*maxVel, (v[2]/speed)*maxVel);
      } else if (speedSq > 0.1 && speedSq < 15 && pos.current[1] < 1.0) {
        // Boost slow balls slightly to keep the game fast-paced
        api.velocity.set(v[0] * 1.02, v[1], v[2] * 1.02);
      }

      if (!isResetting.current) {
        // Failsafe: Prevent ball from escaping the table if physics glitch
        let clampedX = pos.current[0];
        let clampedY = pos.current[1];
        let clampedZ = pos.current[2];
        let needsClamp = false;

        // Table boundaries: x: -13.5 to 13.5, z: -7.0 to 7.0, y: -1.2 to 10
        const inGoalArea = Math.abs(clampedX) >= 12.5 && Math.abs(clampedZ) < 2.5;
        
        if (!inGoalArea && clampedY < -1.0) {
          clampedY = -0.8;
          needsClamp = true;
        }
        if (clampedY > 12) {
          clampedY = 10;
          needsClamp = true;
        }
        if (Math.abs(clampedZ) > 6.8) {
          clampedZ = Math.sign(clampedZ) * 6.6;
          needsClamp = true;
        }
        if (Math.abs(clampedX) > 13.3) {
          if (Math.abs(clampedZ) >= 2.5) {
            clampedX = Math.sign(clampedX) * 13.1;
            needsClamp = true;
          } else if (Math.abs(clampedX) > 14.5) {
            clampedX = Math.sign(clampedX) * 14.0;
            needsClamp = true;
          }
        }

        if (needsClamp) {
          api.position.set(clampedX, clampedY, clampedZ);
          // Dampen velocity slightly when resetting from a glitch
          api.velocity.set(vel.current[0] * 0.5, vel.current[1] * 0.5, vel.current[2] * 0.5);
        }

        // Send sync
        socket.emit('sync_ball', { roomId, position: [clampedX, clampedY, clampedZ], velocity: vel.current });

        // Goal detection
        if (clampedX < -12.5 && Math.abs(clampedZ) < 2.5 && clampedY < -1.5) {
          isResetting.current = true;
          socket.emit('score', { roomId, player: 2 });
        } else if (clampedX > 12.5 && Math.abs(clampedZ) < 2.5 && clampedY < -1.5) {
          isResetting.current = true;
          socket.emit('score', { roomId, player: 1 });
        } else if (Math.abs(clampedX) > 15 || Math.abs(clampedZ) > 9 || clampedY > 12 || clampedY < -6) {
          // Fallback if it completely escapes somehow
          isResetting.current = true;
          socket.emit('vote_reset', { roomId });
        }
      }
    }
  });

  return (
    <mesh ref={ref as any} castShadow>
      <sphereGeometry args={[0.4, 32, 32]} />
      <meshStandardMaterial color="#ffffff" />
    </mesh>
  );
};

const Rod = ({ rodIndex, x, playerPositions, isPlayer1Rod, color }: { rodIndex: number, x: number, playerPositions: number[], isPlayer1Rod: boolean, color: string }) => {
  const maxZ = 6.8 - Math.max(...playerPositions.map(Math.abs));
  const { isHost, roomId, players, myId, mode } = useGameStore();
  
  const myPlayer = players.find(p => p.id === myId);
  const isPlayer1 = myPlayer ? myPlayer.team === 1 : true;
  
  const rodTeam = isPlayer1Rod ? 1 : 2;
  const isMyRod = myPlayer && myPlayer.team === rodTeam && doesPlayerControlRod(mode, myPlayer.team, myPlayer.role, rodIndex);
  
  const isRodAssignedToAnyPlayer = players.some(p => p.team === rodTeam && doesPlayerControlRod(mode, p.team, p.role, rodIndex));
  const isCpuRod = isHost && !isRodAssignedToAnyPlayer;
  
  const canControl = isMyRod || isCpuRod;
  
  const [ref, api] = useCompoundBody(() => ({
    type: 'Kinematic',
    mass: 0,
    position: [x, 0, 0],
    shapes: [
      { type: 'Box' as const, args: [0.2, 0.2, 42], position: [0, 0, 0] },
      ...playerPositions.map(z => ({
        type: 'Box' as const,
        args: [0.6, 2.2, 0.4] as [number, number, number],
        position: [0, 0, z] as [number, number, number]
      }))
    ]
  }));

  const zPos = useRef(0);
  const angle = useRef(0);
  const isRouletting = useRef(false);
  const rouletteAngle = useRef(0);
  const rouletteCooldown = useRef(0);
  const highlightTimer = useRef(0);
  const bodyMats = useRef<THREE.MeshStandardMaterial[][]>([]);

  const { highlightTrigger } = useGameStore();

  useEffect(() => {
    if (highlightTrigger > 0 && isMyRod) {
      highlightTimer.current = 2.0; // Highlight for 2 seconds
    }
  }, [highlightTrigger, isMyRod]);

  useEffect(() => {
    const handleRodSync = (data: { rodIndex: number, zPos: number, angle: number }) => {
      if (!canControl && data.rodIndex === rodIndex) {
        zPos.current = data.zPos;
        angle.current = data.angle;
        api.position.set(x, 0, data.zPos);
        api.rotation.set(0, 0, data.angle);
      }
    };
    socket.on('rod_sync', handleRodSync);
    return () => { socket.off('rod_sync', handleRodSync); };
  }, [canControl, rodIndex, api, x]);

  useFrame((_, delta) => {
    if (!canControl) return;

    if (rouletteCooldown.current > 0) {
      rouletteCooldown.current -= delta;
    }

    const speed = 15; 

    let moveDir = 0;
    let targetAngle = 0;
    let doRoulette = false;

    if (isMyRod) {
      const forward = isPlayer1 ? -1 : 1;
      if (keys.w || keys.ArrowUp) moveDir += forward;
      if (keys.s || keys.ArrowDown) moveDir -= forward;
      
      if (keys.e || keys.E) doRoulette = true;
      else if (keys.d || keys.ArrowRight) targetAngle = Math.PI / 2;
      else if (keys.a || keys.ArrowLeft) targetAngle = -Math.PI / 2;
    } else if (isCpuRod) {
      // Improved CPU Logic
      const targetZ = globalBallPos.z;
      
      // Predict ball position based on velocity
      const distToBallX = globalBallPos.x - x;
      const timeToReach = Math.abs(distToBallX / (globalBallVel.x || 0.001));
      
      let predictedZ = targetZ;
      // Only predict if the ball is moving towards this rod and is relatively close
      const isBallMovingTowardsUs = Math.sign(globalBallVel.x) === Math.sign(x - globalBallPos.x);
      if (isBallMovingTowardsUs && timeToReach < 1.0) {
        predictedZ = targetZ + globalBallVel.z * timeToReach;
        // Account for bounces off the side walls (z = -7.5 to 7.5)
        while (predictedZ > 7.5 || predictedZ < -7.5) {
          if (predictedZ > 7.5) {
            predictedZ = 7.5 - (predictedZ - 7.5);
          } else if (predictedZ < -7.5) {
            predictedZ = -7.5 + (-7.5 - predictedZ);
          }
        }
      }
      
      let minDiff = Infinity;
      let bestDiff = 0;
      
      for (let i = 0; i < playerPositions.length; i++) {
        const pZ = zPos.current + playerPositions[i];
        const diff = predictedZ - pZ;
        if (Math.abs(diff) < minDiff) {
          minDiff = Math.abs(diff);
          bestDiff = diff;
        }
      }
      
      if (minDiff > 0.15) {
        moveDir = Math.sign(bestDiff);
      }
      
      // Kick if ball is near and moving towards our goal, or if we can score
      const isBallInFront = isPlayer1Rod ? distToBallX > -0.2 : distToBallX < 0.2;
      const isBallBehind = isPlayer1Rod ? distToBallX < -0.2 : distToBallX > 0.2;
      
      if (Math.abs(distToBallX) < 1.5 && minDiff < 0.8 && isBallInFront) {
        // Occasionally use roulette for a power shot if cooldown is ready
        if (Math.random() < 0.05 && rouletteCooldown.current <= 0) {
          doRoulette = true;
        } else {
          targetAngle = isPlayer1Rod ? Math.PI / 2 : -Math.PI / 2;
        }
      } else if (Math.abs(distToBallX) < 1.5 && minDiff < 0.8 && isBallBehind) {
        // Ball is right behind us! Do a roulette to sweep it forward!
        doRoulette = true;
      } else if (Math.abs(distToBallX) < 3.0 && isBallBehind) {
        // Lift the rod so the ball can pass to the defender
        targetAngle = isPlayer1Rod ? -Math.PI / 2 : Math.PI / 2;
      }
    }

    // Apply rotation
    const prevAngle = angle.current;

    if (doRoulette && !isRouletting.current && rouletteCooldown.current <= 0) {
      isRouletting.current = true;
      rouletteAngle.current = 0;
      rouletteCooldown.current = 1.5; // 1.5s cooldown
    }

    if (isRouletting.current) {
      const rouletteSpeed = isPlayer1Rod ? 60 : -60; // Very fast and strong
      const step = rouletteSpeed * delta;
      angle.current += step;
      rouletteAngle.current += Math.abs(step);
      if (rouletteAngle.current >= Math.PI * 2) {
        isRouletting.current = false;
        angle.current = angle.current % (Math.PI * 2);
      }
    } else {
      // Use a constant speed for more powerful and consistent kicks
      const diff = targetAngle - angle.current;
      const kickSpeed = 35; // Adjust this for kick power
      if (Math.abs(diff) > 0.01) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), kickSpeed * delta);
        angle.current += step;
      } else {
        angle.current = targetAngle;
      }
    }
    
    // Calculate the actual angular velocity to impart force on the ball
    const angularVel = (angle.current - prevAngle) / delta;

    // Prevent moving into walls to fix physics jitter
    if (zPos.current >= maxZ && moveDir > 0) moveDir = 0;
    if (zPos.current <= -maxZ && moveDir < 0) moveDir = 0;

    zPos.current += moveDir * speed * delta;
    zPos.current = Math.max(-maxZ, Math.min(maxZ, zPos.current));

    api.position.set(x, 0, zPos.current);
    api.rotation.set(0, 0, angle.current);
    
    // Highlight closest player logic
    if (highlightTimer.current > 0) {
      highlightTimer.current -= delta;
    }

    if (isMyRod) {
      let minDist = Infinity;
      let minIdx = -1;
      for (let i = 0; i < playerPositions.length; i++) {
        const pZ = zPos.current + playerPositions[i];
        const dist = Math.hypot(globalBallPos.x - x, globalBallPos.z - pZ);
        if (dist < minDist) {
          minDist = dist;
          minIdx = i;
        }
      }
      
      const isNearRod = Math.abs(globalBallPos.x - x) < 4;
      const isHighlighting = highlightTimer.current > 0;
      
      bodyMats.current.forEach((mats, i) => {
        mats?.forEach(mat => {
          if (isHighlighting) {
            mat.emissive.setHex(0xaaaa00); // Yellow glow
          } else if (isNearRod && i === minIdx) {
            mat.emissive.setHex(0x555555);
          } else {
            mat.emissive.setHex(0x000000);
          }
        });
      });
    }
    
    api.velocity.set(0, 0, moveDir * speed);
    // Setting angular velocity explicitly helps physics transfer momentum to the ball
    api.angularVelocity.set(0, 0, angularVel);

    socket.emit('sync_rod', { roomId, rodIndex, zPos: zPos.current, angle: angle.current });
  });

  return (
    <group ref={ref as any}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 42, 16]} />
        <meshStandardMaterial color="#9e9e9e" metalness={0.8} roughness={0.2} />
      </mesh>
      
      <mesh position={[0, 0, isPlayer1Rod ? 14 : -14]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 2, 16]} />
        <meshStandardMaterial color="#111111" roughness={0.8} />
      </mesh>

      {playerPositions.map((z, i) => (
        <group key={i} position={[0, 0, z]}>
          <mesh position={[0, 1.0, 0]} castShadow>
            <sphereGeometry args={[0.25, 16, 16]} />
            <meshStandardMaterial ref={(el) => { if (el) { if (!bodyMats.current[i]) bodyMats.current[i] = []; bodyMats.current[i][0] = el; } }} color={color} />
          </mesh>
          <mesh position={[0, 0.4, 0]} castShadow>
            <boxGeometry args={[0.5, 1.0, 0.4]} />
            <meshStandardMaterial ref={(el) => { if (el) { if (!bodyMats.current[i]) bodyMats.current[i] = []; bodyMats.current[i][1] = el; } }} color={color} />
          </mesh>
          <mesh position={[0, -0.5, 0]} castShadow>
            <boxGeometry args={[0.4, 0.8, 0.3]} />
            <meshStandardMaterial ref={(el) => { if (el) { if (!bodyMats.current[i]) bodyMats.current[i] = []; bodyMats.current[i][2] = el; } }} color={color} />
          </mesh>
          <mesh position={[0, -1.0, 0]} castShadow>
            <boxGeometry args={[0.4, 0.2, 0.4]} />
            <meshStandardMaterial ref={(el) => { if (el) { if (!bodyMats.current[i]) bodyMats.current[i] = []; bodyMats.current[i][3] = el; } }} color={color} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

const Chat = ({ inGame = false }: { inGame?: boolean }) => {
  const { chat, roomId } = useGameStore();
  const [text, setText] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [chat]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && inGame && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inGame]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      inputRef.current?.blur();
      return;
    }
    socket.emit('send_chat', { roomId, text });
    setText('');
    inputRef.current?.blur();
  };

  return (
    <div className={`flex flex-col h-full absolute inset-0 ${inGame ? `bg-black/60 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden shadow-2xl transition-opacity duration-300 ${isFocused ? 'opacity-100' : 'opacity-30 hover:opacity-100'}` : ''}`}>
      <div className="bg-white/5 px-4 py-2 border-b border-white/10 font-bold text-white/80 text-xs uppercase tracking-widest flex justify-between items-center shrink-0">
        <span>Team Chat</span>
      </div>
      <div ref={chatRef} className="flex-grow overflow-y-auto p-4 flex flex-col gap-2 min-h-0">
        {chat.map((msg, i) => (
          <div key={i} className="text-sm break-words">
            <span className="font-bold text-blue-400">{msg.sender}: </span>
            <span className="text-white/90">{msg.text}</span>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="border-t border-white/10 flex bg-black/20 shrink-0">
        <input 
          ref={inputRef}
          type="text" 
          value={text}
          onChange={e => setText(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Type a message..." 
          className="flex-grow bg-transparent text-white px-4 py-3 text-sm focus:outline-none min-w-0"
        />
        <button type="submit" className="px-4 text-blue-400 font-bold hover:text-blue-300 transition-colors text-sm shrink-0">SEND</button>
      </form>
    </div>
  );
};

const RoomLobby = () => {
  const { roomId, mode, players, myId, setGameState } = useGameStore();
  const isHost = players[0]?.id === myId;

  const selectSlot = (team: 1 | 2, role: number) => {
    socket.emit('select_slot', { roomId, team, role });
  };

  const startGame = () => {
    socket.emit('start_game', { roomId });
  };

  const leaveMatch = () => {
    socket.emit('leave_room');
    setGameState({ lobbyState: 'menu', roomId: '', players: [], score1: 0, score2: 0, winner: null });
  };

  const renderSlot = (team: 1 | 2, role: number, label: string) => {
    const player = players.find(p => p.team === team && p.role === role);
    const isMe = player?.id === myId;
    
    return (
      <div 
        onClick={() => !player && selectSlot(team, role)}
        className={`p-3 rounded-lg border ${player ? (team === 1 ? 'border-red-500/50 bg-red-500/10' : 'border-blue-500/50 bg-blue-500/10') : 'border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer'} transition-colors flex flex-col items-center justify-center min-h-[80px]`}
      >
        <span className="text-xs uppercase tracking-widest text-white/50 mb-1">{label}</span>
        {player ? (
          <span className={`font-bold ${isMe ? 'text-white' : 'text-white/80'}`}>{player.name} {isMe && '(You)'}</span>
        ) : (
          <span className="text-white/30 italic text-sm">Empty Slot</span>
        )}
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#050505] p-8">
      <div className="max-w-6xl w-full grid grid-cols-[1fr_300px] gap-8 h-full max-h-[800px]">
        
        <div className="bg-zinc-900/90 backdrop-blur-xl rounded-3xl border border-white/10 p-8 flex flex-col relative overflow-hidden shadow-2xl">
          <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-4">
              <button onClick={leaveMatch} className="bg-white/5 hover:bg-white/10 border border-white/10 text-white p-2 rounded-lg transition-colors" title="Leave Match">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              </button>
              <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Match Setup</h2>
            </div>
            <div className="bg-black/50 px-4 py-2 rounded-lg border border-white/10">
              <span className="text-white/50 text-sm uppercase tracking-widest mr-2">Invite Code:</span>
              <span className="text-xl font-mono font-bold text-white">{roomId}</span>
            </div>
          </div>

          <div className="flex-grow flex flex-col justify-center gap-12 relative z-10">
            {/* Team 1 (Red) */}
            <div className="flex flex-col gap-4">
              <h3 className="text-red-500 font-bold uppercase tracking-widest text-xl">Team Red</h3>
              <div className="grid grid-cols-3 gap-4">
                {mode === '1v1' || mode === 'solo' ? (
                  <div className="col-span-3">{renderSlot(1, 0, 'All Positions')}</div>
                ) : mode === '2v2' ? (
                  <>
                    <div className="col-span-1">{renderSlot(1, 0, 'Goalie & Def')}</div>
                    <div className="col-span-2">{renderSlot(1, 1, 'Mid & Attack')}</div>
                  </>
                ) : (
                  <>
                    <div className="col-span-1">{renderSlot(1, 0, 'Goalie & Def')}</div>
                    <div className="col-span-1">{renderSlot(1, 1, 'Midfield')}</div>
                    <div className="col-span-1">{renderSlot(1, 2, 'Attack')}</div>
                  </>
                )}
              </div>
            </div>

            <div className="h-px w-full bg-white/10 relative">
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 px-4 text-white/30 font-bold italic">VS</div>
            </div>

            {/* Team 2 (Blue) */}
            <div className="flex flex-col gap-4">
              <h3 className="text-blue-500 font-bold uppercase tracking-widest text-xl">Team Blue</h3>
              <div className="grid grid-cols-3 gap-4">
                {mode === '1v1' || mode === 'solo' ? (
                  <div className="col-span-3">{renderSlot(2, 0, 'All Positions')}</div>
                ) : mode === '2v2' ? (
                  <>
                    <div className="col-span-2">{renderSlot(2, 1, 'Mid & Attack')}</div>
                    <div className="col-span-1">{renderSlot(2, 0, 'Goalie & Def')}</div>
                  </>
                ) : (
                  <>
                    <div className="col-span-1">{renderSlot(2, 2, 'Attack')}</div>
                    <div className="col-span-1">{renderSlot(2, 1, 'Midfield')}</div>
                    <div className="col-span-1">{renderSlot(2, 0, 'Goalie & Def')}</div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Background SVG Table Preview */}
          <div className="absolute inset-0 pointer-events-none opacity-5 flex items-center justify-center">
            <svg width="80%" height="80%" viewBox="0 0 100 60" fill="none" stroke="white" strokeWidth="1">
              <rect x="5" y="5" width="90" height="50" rx="2" />
              <line x1="50" y1="5" x2="50" y2="55" />
              <circle cx="50" cy="30" r="8" />
              <rect x="5" y="20" width="10" height="20" />
              <rect x="85" y="20" width="10" height="20" />
              {/* Rods */}
              <line x1="12" y1="0" x2="12" y2="60" />
              <line x1="22" y1="0" x2="22" y2="60" />
              <line x1="32" y1="0" x2="32" y2="60" />
              <line x1="42" y1="0" x2="42" y2="60" />
              <line x1="58" y1="0" x2="58" y2="60" />
              <line x1="68" y1="0" x2="68" y2="60" />
              <line x1="78" y1="0" x2="78" y2="60" />
              <line x1="88" y1="0" x2="88" y2="60" />
            </svg>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex-grow bg-zinc-900/80 backdrop-blur-xl rounded-3xl border border-white/10 relative overflow-hidden shadow-2xl">
            <Chat />
          </div>
          {isHost ? (
            <button onClick={startGame} className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-6 px-4 rounded-3xl transition-colors text-xl shadow-lg uppercase tracking-widest">
              Start Match
            </button>
          ) : (
            <div className="bg-white/5 border border-white/10 text-white/50 font-bold py-6 px-4 rounded-3xl text-center text-xl uppercase tracking-widest">
              Waiting for Host
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

const MainMenu = () => {
  const { setGameState } = useGameStore();
  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('foosball_name') || 'Player' + Math.floor(Math.random() * 1000));
  const [error, setError] = useState('');

  useEffect(() => {
    if (playerName.trim()) {
      localStorage.setItem('foosball_name', playerName.trim());
    }
  }, [playerName]);

  const createRoom = (mode: GameMode) => {
    if (!playerName.trim()) return setError("Enter a name");
    socket.emit('create_room', { mode, name: playerName }, (res: any) => {
      if (res.success) {
        setGameState({ 
          lobbyState: res.roomState.status, 
          roomId: res.roomId, 
          mode: res.roomState.mode,
          players: res.roomState.players,
          myId: socket.id,
          isHost: true,
          score1: 0,
          score2: 0,
          winner: null
        });
      }
    });
  };

  const joinRoom = () => {
    if (!joinCode.trim()) return setError("Enter a code");
    if (!playerName.trim()) return setError("Enter a name");
    socket.emit('join_room', { roomId: joinCode.toUpperCase(), name: playerName }, (res: any) => {
      if (res.success) {
        setGameState({ 
          lobbyState: res.roomState.status, 
          roomId: res.roomId, 
          mode: res.roomState.mode,
          players: res.roomState.players,
          myId: socket.id,
          isHost: false,
          score1: res.roomState.score1, 
          score2: res.roomState.score2,
          winner: null
        });
      } else {
        setError(res.message);
      }
    });
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-zinc-900/90 backdrop-blur-xl p-8 sm:p-10 rounded-[2rem] border border-white/10 flex flex-col gap-8 max-w-4xl w-full shadow-[0_0_50px_rgba(0,0,0,0.5)] my-auto">
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-4xl sm:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-white/50 tracking-tighter text-center w-full">
            QUICK<span className="text-emerald-400">FOOSBALL</span>
          </h1>
          <p className="text-white/40 font-medium tracking-widest uppercase text-xs sm:text-sm mt-1">Multiplayer Arena</p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-8 md:gap-12">
          {/* Left Column: Create */}
          <div className="flex-1 flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-white/50 text-[10px] font-bold uppercase tracking-widest ml-2">Player Name</label>
              <input 
                type="text" 
                placeholder="YOUR NAME" 
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="bg-black/50 border border-white/10 text-white px-4 py-3.5 rounded-xl text-center uppercase tracking-widest font-bold focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-white/50 text-[10px] font-bold uppercase tracking-widest ml-2">Create Match</label>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => createRoom('solo')} className="bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 text-white font-bold py-4 px-2 rounded-xl transition-all text-xs sm:text-sm uppercase tracking-widest">Solo vs CPU</button>
                <button onClick={() => createRoom('1v1')} className="bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 text-white font-bold py-4 px-2 rounded-xl transition-all text-xs sm:text-sm uppercase tracking-widest">1v1 Match</button>
                <button onClick={() => createRoom('2v2')} className="bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 text-white font-bold py-4 px-2 rounded-xl transition-all text-xs sm:text-sm uppercase tracking-widest">2v2 Match</button>
                <button onClick={() => createRoom('3v3')} className="bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 text-white font-bold py-4 px-2 rounded-xl transition-all text-xs sm:text-sm uppercase tracking-widest">3v3 Match</button>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="hidden md:block w-px bg-white/10"></div>
          <div className="md:hidden relative flex items-center py-1">
            <div className="flex-grow border-t border-white/10"></div>
            <span className="flex-shrink-0 mx-4 text-white/30 text-[10px] font-bold uppercase tracking-widest">Or</span>
            <div className="flex-grow border-t border-white/10"></div>
          </div>

          {/* Right Column: Join */}
          <div className="flex-1 flex flex-col gap-6 justify-center">
            <div className="flex flex-col gap-2">
              <label className="text-white/50 text-[10px] font-bold uppercase tracking-widest ml-2">Join Existing Match</label>
              <input 
                type="text" 
                placeholder="ENTER INVITE CODE" 
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="bg-black/50 border border-white/10 text-white px-4 py-4 rounded-xl text-center uppercase tracking-widest font-mono focus:outline-none focus:border-blue-500 text-lg transition-colors"
              />
            </div>
            {error && <p className="text-red-400 text-sm text-center font-medium bg-red-400/10 py-2 rounded-lg border border-red-400/20">{error}</p>}
            <button onClick={joinRoom} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-4 rounded-xl transition-all text-lg shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)] uppercase tracking-widest mt-auto">
              Join Game
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Scoreboard = () => {
  const { score1, score2, players, myId, resetVotes, roomId, setGameState } = useGameStore();
  const myPlayer = players.find(p => p.id === myId);
  const isPlayer1 = myPlayer ? myPlayer.team === 1 : true;
  
  const leaveMatch = () => {
    socket.emit('leave_room');
    setGameState({ lobbyState: 'menu', roomId: '', players: [], score1: 0, score2: 0, winner: null });
  };

  return (
    <>
      <div className="absolute top-8 left-8 pointer-events-auto">
        <button onClick={leaveMatch} className="bg-black/50 hover:bg-black/80 backdrop-blur-md border border-white/10 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2 font-bold text-sm uppercase tracking-widest shadow-lg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          Quit
        </button>
      </div>
      <div className="absolute top-8 left-0 w-full flex flex-col justify-center items-center pointer-events-none gap-4">
        <div className="bg-black/80 text-white px-8 py-4 rounded-2xl border border-white/10 flex gap-8 items-center shadow-2xl backdrop-blur-md">
          <div className="flex flex-col items-center">
            <span className="text-red-500 font-bold text-sm tracking-widest uppercase">Team Red {isPlayer1 ? '(You)' : ''}</span>
            <span className="text-5xl font-mono font-bold">{score1}</span>
          </div>
          <div className="text-3xl font-bold text-white/30">-</div>
          <div className="flex flex-col items-center">
            <span className="text-blue-500 font-bold text-sm tracking-widest uppercase">Team Blue {!isPlayer1 ? '(You)' : ''}</span>
            <span className="text-5xl font-mono font-bold">{score2}</span>
          </div>
        </div>
        
        {resetVotes > 0 && (
          <div className="bg-yellow-500/20 text-yellow-300 px-4 py-2 rounded-full border border-yellow-500/30 text-sm font-medium backdrop-blur-md">
            Reset votes: {resetVotes}
          </div>
        )}
      </div>
    </>
  );
};

const ControlsHelp = () => {
  return (
    <div className="hidden sm:flex absolute bottom-8 left-8 text-white/50 text-sm flex-col gap-2 bg-black/20 hover:bg-black/60 p-4 rounded-xl backdrop-blur-sm border border-white/5 opacity-30 hover:opacity-100 transition-all duration-300 pointer-events-auto">
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"></div>
        <span><strong className="text-white">W/S</strong> or <strong className="text-white">Up/Down</strong> Move Rods</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"></div>
        <span><strong className="text-white">A/D</strong> or <strong className="text-white">Left/Right</strong> Hold Angle</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"></div>
        <span><strong className="text-white">E</strong> Power Roulette (1.5s Cooldown)</span>
      </div>
      <div className="mt-2 pt-2 border-t border-white/10">
        <span><strong className="text-white">1</strong> Highlight Your Players</span>
      </div>
      <div className="flex items-center gap-3">
        <span><strong className="text-white">0</strong> Change Camera View</span>
      </div>
      <div className="flex items-center gap-3">
        <span><strong className="text-white">Space</strong> Vote to Reset Ball</span>
      </div>
    </div>
  );
};

const MobileControls = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window) || navigator.maxTouchPoints > 0);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (!isMobile) return null;

  const handleTouchStart = (key: string) => (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    keys[key] = true;
  };

  const handleTouchEnd = (key: string) => (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    keys[key] = false;
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-40 flex flex-col justify-end p-4 pb-8 sm:hidden">
      <div className="flex justify-between items-end w-full">
        {/* Left side: Movement (Up/Down) */}
        <div className="flex flex-col gap-4 pointer-events-auto">
          <button 
            onTouchStart={handleTouchStart('w')} 
            onTouchEnd={handleTouchEnd('w')}
            onMouseDown={handleTouchStart('w')}
            onMouseUp={handleTouchEnd('w')}
            onMouseLeave={handleTouchEnd('w')}
            className="w-16 h-16 bg-white/10 active:bg-white/30 rounded-full border border-white/20 flex items-center justify-center backdrop-blur-md"
          >
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
          </button>
          <button 
            onTouchStart={handleTouchStart('s')} 
            onTouchEnd={handleTouchEnd('s')}
            onMouseDown={handleTouchStart('s')}
            onMouseUp={handleTouchEnd('s')}
            onMouseLeave={handleTouchEnd('s')}
            className="w-16 h-16 bg-white/10 active:bg-white/30 rounded-full border border-white/20 flex items-center justify-center backdrop-blur-md"
          >
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
        </div>

        {/* Right side: Actions (Left/Right angle, Roulette) */}
        <div className="flex flex-col gap-4 items-end pointer-events-auto">
          <button 
            onTouchStart={handleTouchStart('e')} 
            onTouchEnd={handleTouchEnd('e')}
            onMouseDown={handleTouchStart('e')}
            onMouseUp={handleTouchEnd('e')}
            onMouseLeave={handleTouchEnd('e')}
            className="w-20 h-20 bg-emerald-500/40 active:bg-emerald-500/70 rounded-full border border-emerald-400/50 flex items-center justify-center backdrop-blur-md mb-2 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
          >
            <span className="text-white font-bold text-lg">KICK</span>
          </button>
          <div className="flex gap-4">
            <button 
              onTouchStart={handleTouchStart('a')} 
              onTouchEnd={handleTouchEnd('a')}
              onMouseDown={handleTouchStart('a')}
              onMouseUp={handleTouchEnd('a')}
              onMouseLeave={handleTouchEnd('a')}
              className="w-16 h-16 bg-white/10 active:bg-white/30 rounded-full border border-white/20 flex items-center justify-center backdrop-blur-md"
            >
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button 
              onTouchStart={handleTouchStart('d')} 
              onTouchEnd={handleTouchEnd('d')}
              onMouseDown={handleTouchStart('d')}
              onMouseUp={handleTouchEnd('d')}
              onMouseLeave={handleTouchEnd('d')}
              className="w-16 h-16 bg-white/10 active:bg-white/30 rounded-full border border-white/20 flex items-center justify-center backdrop-blur-md"
            >
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const GameOverScreen = () => {
  const { winner, score1, score2, players, setGameState, roomId, isHost } = useGameStore();

  const leaveMatch = () => {
    socket.emit('leave_room');
    setGameState({ lobbyState: 'menu', roomId: '', players: [], score1: 0, score2: 0, winner: null });
  };

  const team1Players = players.filter(p => p.team === 1);
  const team2Players = players.filter(p => p.team === 2);

  const playAgain = () => {
    socket.emit('play_again', { roomId });
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-zinc-900/90 backdrop-blur-xl p-10 rounded-[2rem] border border-white/10 flex flex-col gap-8 max-w-2xl w-full shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-white/50 tracking-tighter">GAME OVER</h1>
          <p className={`text-2xl font-bold ${winner === 1 ? 'text-red-500' : 'text-blue-500'}`}>
            TEAM {winner} WINS!
          </p>
        </div>

        <div className="flex justify-between items-center px-10">
          <div className="flex flex-col items-center gap-4">
            <div className="text-5xl font-black text-red-500">{score1}</div>
            <div className="flex flex-col gap-2">
              {team1Players.map(p => (
                <div key={p.id} className="bg-red-500/10 border border-red-500/30 px-4 py-2 rounded-lg text-white font-medium text-center">
                  {p.name}
                </div>
              ))}
              {team1Players.length === 0 && (
                <div className="bg-red-500/10 border border-red-500/30 px-4 py-2 rounded-lg text-white/50 font-medium text-center">
                  CPU
                </div>
              )}
            </div>
          </div>

          <div className="text-white/30 font-black text-3xl">VS</div>

          <div className="flex flex-col items-center gap-4">
            <div className="text-5xl font-black text-blue-500">{score2}</div>
            <div className="flex flex-col gap-2">
              {team2Players.map(p => (
                <div key={p.id} className="bg-blue-500/10 border border-blue-500/30 px-4 py-2 rounded-lg text-white font-medium text-center">
                  {p.name}
                </div>
              ))}
              {team2Players.length === 0 && (
                <div className="bg-blue-500/10 border border-blue-500/30 px-4 py-2 rounded-lg text-white/50 font-medium text-center">
                  CPU
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-4 mt-4">
          {isHost ? (
            <button 
              onClick={playAgain}
              className="flex-1 bg-white text-black font-bold py-4 rounded-xl hover:bg-gray-200 transition-colors uppercase tracking-widest text-sm"
            >
              Play Again
            </button>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-white/5 text-white/50 font-bold py-4 rounded-xl uppercase tracking-widest text-sm border border-white/5">
              Waiting for Host...
            </div>
          )}
          <button 
            onClick={leaveMatch}
            className="flex-1 bg-white/10 text-white font-bold py-4 rounded-xl hover:bg-white/20 transition-colors uppercase tracking-widest text-sm"
          >
            Leave Match
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const { lobbyState, setGameState, triggerReset } = useGameStore();

  useEffect(() => {
    socket.on('room_updated', (room) => {
      setGameState({ 
        lobbyState: room.status,
        players: room.players,
        mode: room.mode,
        isHost: room.players[0]?.id === socket.id
      });
    });

    socket.on('chat_message', (msg) => {
      setGameState({ chat: [...useGameStore.getState().chat, msg] });
    });

    socket.on('score_update', (data) => {
      setGameState({ score1: data.score1, score2: data.score2 });
    });

    socket.on('reset_votes', (votes) => {
      setGameState({ resetVotes: votes });
    });

    socket.on('trigger_reset', () => {
      triggerReset();
    });

    socket.on('game_over', (data) => {
      setGameState({ lobbyState: 'gameover', winner: data.winner, score1: data.score1, score2: data.score2 });
    });

    return () => {
      socket.off('room_updated');
      socket.off('chat_message');
      socket.off('score_update');
      socket.off('reset_votes');
      socket.off('trigger_reset');
      socket.off('game_over');
    };
  }, [setGameState, triggerReset]);

  const rods = [
    { x: -10.5, playerPositions: [0], isPlayer1Rod: true, color: '#ef4444' },
    { x: -7.5, playerPositions: [-3, 3], isPlayer1Rod: true, color: '#ef4444' },
    { x: -4.5, playerPositions: [-4, 0, 4], isPlayer1Rod: false, color: '#3b82f6' },
    { x: -1.5, playerPositions: [-5.2, -2.6, 0, 2.6, 5.2], isPlayer1Rod: true, color: '#ef4444' },
    { x: 1.5, playerPositions: [-5.2, -2.6, 0, 2.6, 5.2], isPlayer1Rod: false, color: '#3b82f6' },
    { x: 4.5, playerPositions: [-4, 0, 4], isPlayer1Rod: true, color: '#ef4444' },
    { x: 7.5, playerPositions: [-3, 3], isPlayer1Rod: false, color: '#3b82f6' },
    { x: 10.5, playerPositions: [0], isPlayer1Rod: false, color: '#3b82f6' },
  ];

  return (
    <div className="w-full h-screen bg-[#050505] overflow-hidden relative font-sans">
      {lobbyState === 'menu' && <MainMenu />}
      {lobbyState === 'lobby' && <RoomLobby />}
      {lobbyState === 'gameover' && <GameOverScreen />}
      {(lobbyState === 'playing' || lobbyState === 'gameover') && (
        <>
          {lobbyState === 'playing' && (
            <>
              <KeyboardController />
              <MobileControls />
            </>
          )}
          <Canvas shadows camera={{ position: [0, 18, 6], fov: 45 }}>
            <color attach="background" args={['#050505']} />
            
            <ambientLight intensity={0.4} />
            <directionalLight 
              position={[0, 20, 0]} 
              intensity={1.5} 
              castShadow 
              shadow-mapSize-width={2048} 
              shadow-mapSize-height={2048}
              shadow-camera-left={-15}
              shadow-camera-right={15}
              shadow-camera-top={10}
              shadow-camera-bottom={-10}
            />
            <pointLight position={[-10, 10, 0]} intensity={0.5} />
            <pointLight position={[10, 10, 0]} intensity={0.5} />

            <Physics gravity={[0, -30, 0]} defaultContactMaterial={{ friction: 0.1, restitution: 0.6 }}>
              <Table />
              <Ball />
              {rods.map((rod, i) => (
                <Rod key={i} rodIndex={i} x={rod.x} playerPositions={rod.playerPositions} isPlayer1Rod={rod.isPlayer1Rod} color={rod.color} />
              ))}
            </Physics>
          </Canvas>
          <Scoreboard />
          <ControlsHelp />
          {/* In-game chat */}
          <div className="absolute bottom-8 right-8 w-80 h-64 z-10 pointer-events-auto opacity-30 hover:opacity-100 transition-opacity duration-300">
            <Chat inGame={true} />
          </div>
        </>
      )}
    </div>
  );
}
