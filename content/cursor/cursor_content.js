// Agent cursor overlay, injected on demand into the controlled tab.
// Ported from browser-control-bridge (cursorMotion + cursorOverlay). Kept as a
// single self-contained file because chrome.scripting.executeScript injects it
// as a classic script (no ES module imports).

const CURSOR_SIZE = 24;
const HALF_CURSOR_SIZE = CURSOR_SIZE / 2;
const DEFAULT_ROTATION = normalizeDegrees(-44);
const FALLBACK_X_RATIO = 0.58;
const FALLBACK_Y_RATIO = 0.55;
const SHORT_MOVE_MAX_DISTANCE = 196;
const ARRIVAL_DISTANCE_PX = 0.85;
const ARRIVAL_VELOCITY_PX = 12;
const FRAME_SECONDS = 1 / 60;
const SPRING_STEP_SECONDS = 1 / 240;
const MAX_SPRING_CATCHUP_SECONDS = 1;
const SPRING_SETTLE_THRESHOLD = 0.001 * 60;
const CURSOR_CLICK_ANGLE_DEGREES = -44;
const BEZIER_DAMPING_FRACTION = 0.9;
const MIN_BEZIER_RESPONSE = 0.12;
const MAX_BEZIER_RESPONSE = 2.2;
const BEZIER_RESPONSE_SCALE = 0.7;
const THINK_DURATION_SECONDS = 1.41;
const THINK_PERIOD_SECONDS = 0.66;
const THINK_ROTATION_DEGREES = 12.5;
const PATH_CONFIG = {
    arcFlow: 0.5783555327868779,
    arcSize: 0.2765523188064277,
    boundsMargin: 20,
    candidateCount: 20,
    clickAngleDegrees: CURSOR_CLICK_ANGLE_DEGREES,
    endpointHandle: 0.15,
    startHandle: 0.41960295031576633,
};

const RESPONSE = {
    position: 0.19,
    rotation: 0.12,
    stretch: 0.2,
    visibility: 0.42,
    scoot: 0.19,
    scootRotation: 0.055,
    scootStretch: 0.12,
};

const DAMPING = {
    position: 0.9,
    rotation: 0.9,
    stretch: 0.85,
    visibility: 0.86,
    scoot: 0.94,
    scootRotation: 0.82,
    scootStretch: 0.86,
};

const ROOT_ID = 'gemini-nexus-cursor-root';
const ROOT_ATTR = 'geminiNexusCursorRoot';
const CURSOR_ASSET_URL = chrome.runtime.getURL('assets/cursors/cursor-chat.png');

class CursorMotion {
    constructor() {
        this.state = null;
    }

    setState(input, now = currentTime()) {
        const turnKey = input.turnKey ?? '';
        const cursor = input.cursor;
        const hasCursor = cursor != null;
        const target = cursorPoint(cursor, input.viewportSize);
        const visible = input.isVisible && cursor?.visible !== false;
        const moveSequence = Number.isInteger(cursor?.moveSequence) ? cursor.moveSequence : null;
        const cursorKey = moveSequence == null ? null : `${input.turnKey ?? ''}:${moveSequence}`;

        if (!this.state) {
            this.state = createMotionState(target, visible, now);
        }

        const state = this.state;
        state.lastTime = now;
        state.visibilitySpring.target = visible ? 1 : 0;

        const isThinkAppear = visible && !hasCursor;
        if (isThinkAppear && state.thinkTurnKey !== turnKey) {
            state.thinkTurnKey = turnKey;
            resetSpring(state.visibilitySpring, 1);
            state.thinkStartedAt = now;
        }

        if (!hasCursor) {
            snapToPoint(state, target);
            return this.renderFrame(null);
        }

        state.thinkStartedAt = null;
        state.moveSequence = moveSequence;

        const isNewMove = cursorKey !== state.cursorKey;
        if (isNewMove) {
            state.cursorKey = cursorKey;
            state.arrivedKey = null;
            const distance = pointDistance(state.point, target);
            const appeared = visible && state.visibilitySpring.value <= 0.001;

            if (cursor.animateMovement === false || appeared || distance < 0.5) {
                snapToPoint(state, target);
                state.motion = null;
                state.arrivedKey = cursorKey;
                return this.renderFrame(moveSequence);
            }

            const path = createCursorPath({
                bounds: input.viewportSize,
                end: target,
                start: state.point,
            });
            state.thinkStartedAt = null;
            if (path.mode === 'bezier') {
                const response = bezierSpringResponse(path);
                setPositionSpringResponse(
                    state,
                    positionSpringResponse(response.response),
                    response.dampingFraction
                );
                state.motion = {
                    ...path,
                    progressSpring: spring(0, 1, response.response, response.dampingFraction),
                };
            } else {
                setPositionSpringResponse(state, RESPONSE.position, DAMPING.position);
                state.motion = {
                    ...path,
                    progressSpring: spring(0, 1, RESPONSE.scoot, DAMPING.scoot),
                };
            }
        }

        return this.tick(now);
    }

    tick(now = currentTime()) {
        const state = this.state;
        if (!state) return emptyFrame();

        // 复刻 browser-control-bridge:用真实 elapsed(含高刷屏 ~1/120s)让动画与墙钟同步;
        // 仅首帧 elapsed===0 时补一个名义帧。统一垫到 1/60s 会让 120Hz+ 屏幕光标跑快约 2 倍。
        const elapsed = (now - state.lastTime) / 1_000;
        const deltaSeconds = elapsed === 0 ? FRAME_SECONDS : Math.max(0, elapsed);
        state.lastTime = now;

        const arrived = this.step(deltaSeconds);
        return this.renderFrame(arrived);
    }

    step(deltaSeconds) {
        const state = this.state;
        if (!state) return null;

        let arrivedMoveSequence = null;
        if (state.motion?.mode === 'bezier') {
            const motion = state.motion;
            stepSpring(motion.progressSpring, deltaSeconds);
            const progress = clamp(motion.progressSpring.value, 0, 1);
            const sample = sampleBezierPath(motion, progress);
            state.positionXSpring.target = sample.point.x;
            state.positionYSpring.target = sample.point.y;
            setRotationalTarget(state.rotationSpring, rotationForTangent(sample.tangent));
            state.scootAxisSpring.target = 0;
            state.scootStretchSpring.target = 1;
            state.scootRotationSpring.target = 0;
            state.stretchSpring.target = stretchForSpeed(stepPosition(state, deltaSeconds).speed);
            if (
                progress >= 0.999 &&
                Math.abs(motion.progressSpring.velocity) < 0.01 &&
                pointArrived(state, sample.point)
            ) {
                snapToPoint(state, sample.point);
                state.motion = null;
                state.thinkStartedAt = state.lastTime;
                arrivedMoveSequence = this.markArrived();
            }
        } else if (state.motion?.mode === 'scoot') {
            const motion = state.motion;
            stepSpring(motion.progressSpring, deltaSeconds);
            state.positionXSpring.target = motion.end.x;
            state.positionYSpring.target = motion.end.y;
            state.rotationSpring.target = DEFAULT_ROTATION;
            state.scootAxisSpring.target = motion.axisRotation;
            const progress = progressBetween(
                stepPosition(state, deltaSeconds).point,
                motion.start,
                motion.end
            );
            const wave = Math.sin(clamp(progress, 0, 1) * Math.PI);
            state.scootStretchSpring.target = interpolate(1, interpolate(1, 0, wave), 0.15);
            state.scootRotationSpring.target = motion.rotationTarget * wave;
            state.stretchSpring.target = 1;
            if (
                progress >= 0.999 &&
                Math.abs(motion.progressSpring.velocity) < 0.01 &&
                pointArrived(state, motion.end)
            ) {
                snapToPoint(state, motion.end);
                resetScoot(state);
                state.motion = null;
                state.thinkStartedAt = state.lastTime;
                arrivedMoveSequence = this.markArrived();
            }
        } else {
            stepPosition(state, deltaSeconds);
        }

        stepSpring(state.visibilitySpring, deltaSeconds);
        stepSpring(state.stretchSpring, deltaSeconds);
        stepSpring(state.scootStretchSpring, deltaSeconds);
        stepSpring(state.scootRotationSpring, deltaSeconds);

        return arrivedMoveSequence;
    }

    markArrived() {
        const state = this.state;
        if (!state || state.cursorKey == null || state.arrivedKey === state.cursorKey) return null;
        state.arrivedKey = state.cursorKey;
        return state.moveSequence;
    }

    renderFrame(arrivedMoveSequence) {
        const state = this.state;
        if (!state) return emptyFrame();

        const visibility = clamp(state.visibilitySpring.value, 0, 1);
        const baseScale = interpolate(0.4, 1, visibility);
        const blur = interpolate(5, 0, visibility);
        const scootStretch = clamp(state.scootStretchSpring.value, 0, 1);
        const rotation = currentRotation(state, state.lastTime);
        const transform = [
            `translate3d(${round(state.point.x - HALF_CURSOR_SIZE)}px, ${round(state.point.y - HALF_CURSOR_SIZE)}px, 0)`,
        ];

        if (
            Math.abs(shortestAngle(0, state.scootAxisRotation)) > 0.001 ||
            Math.abs(scootStretch - 1) > 0.001
        ) {
            transform.push(
                `rotate(${round(state.scootAxisRotation)}deg)`,
                `scale(1, ${round(scootStretch)})`,
                `rotate(${round(-state.scootAxisRotation)}deg)`
            );
        }

        transform.push(
            `rotate(${round(normalizeDegrees(rotation + state.scootRotationSpring.value))}deg)`,
            `scale(${round(state.stretchSpring.value * baseScale)}, ${round(baseScale)})`
        );

        return {
            arrivedMoveSequence,
            filter: `blur(${round(blur)}px)`,
            opacity: String(round(visibility)),
            shouldContinue: isMoving(state),
            transform: transform.join(' '),
        };
    }
}

class CursorOverlay {
    constructor(onArrived) {
        this.onArrived = onArrived;
        this.root = null;
        this.cursorElement = null;
        this.state = null;
        this.animationFrame = null;
        this.motion = new CursorMotion();
    }

    mount() {
        if (this.root?.isConnected) return;
        this.unmount();

        const existing = document.getElementById(ROOT_ID);
        if (existing instanceof HTMLDivElement && existing.dataset[ROOT_ATTR] === 'true') {
            existing.remove();
        }

        const root = document.createElement('div');
        root.id = ROOT_ID;
        root.dataset[ROOT_ATTR] = 'true';
        root.setAttribute('data-gemini-nexus-ui', 'cursor');
        const shadow = root.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent = cssText();
        const layer = document.createElement('div');
        layer.className = 'gemini-nexus-cursor-overlay';

        const cursor = document.createElement('div');
        cursor.className = 'gemini-nexus-cursor';

        const image = document.createElement('img');
        image.alt = '';
        image.draggable = false;
        image.width = 23;
        image.height = 24;
        image.src = CURSOR_ASSET_URL;

        cursor.appendChild(image);
        layer.appendChild(cursor);
        shadow.append(style, layer);
        document.documentElement.appendChild(root);

        this.root = root;
        this.cursorElement = cursor;
        this.render();
    }

    unmount() {
        this.cancelAnimation();
        this.root?.remove();
        this.root = null;
        this.cursorElement = null;
    }

    setState(state) {
        this.state = state;
        this.mount();
        this.render();
    }

    render() {
        const cursorElement = this.cursorElement;
        if (!cursorElement) return;

        this.applyFrame(
            this.motion.setState({
                cursor: this.state?.cursor ?? null,
                isVisible: this.state?.isVisible === true && this.state?.sessionId != null,
                turnKey:
                    this.state?.sessionId == null
                        ? null
                        : `${this.state.sessionId}:${this.state.turnId ?? ''}`,
                viewportSize: viewportSize(),
            })
        );
    }

    applyFrame(frame) {
        const cursorElement = this.cursorElement;
        if (!cursorElement) return;

        cursorElement.style.opacity = frame.opacity;
        cursorElement.style.filter = frame.filter;
        cursorElement.style.transform = frame.transform;

        if (frame.arrivedMoveSequence != null) {
            this.onArrived(frame.arrivedMoveSequence);
        }
        if (frame.shouldContinue) this.scheduleAnimation();
    }

    scheduleAnimation() {
        if (this.animationFrame != null) return;
        this.animationFrame = requestAnimationFrame((now) => {
            this.animationFrame = null;
            this.applyFrame(this.motion.tick(now));
        });
    }

    cancelAnimation() {
        if (this.animationFrame == null) return;
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
    }
}

function createCursorPath(args) {
    if (pointDistance(args.start, args.end) <= SHORT_MOVE_MAX_DISTANCE) {
        const direction = normalizePoint({
            x: args.end.x - args.start.x,
            y: args.end.y - args.start.y,
        });
        return {
            axisRotation:
                pointDistance({ x: 0, y: 0 }, direction) < 0.001
                    ? 0
                    : (Math.atan2(direction.y, direction.x) * 180) / Math.PI,
            end: args.end,
            mode: 'scoot',
            rotationTarget: clamp(direction.x * 0.75 + -direction.y * 0.62, -1, 1) * 70,
            start: args.start,
        };
    }

    return selectBezierCandidate(buildBezierCandidates(args), args.bounds);
}

function buildBezierCandidates(args) {
    const clickTangent = degreesToPoint(PATH_CONFIG.clickAngleDegrees);
    const distance = pointDistance(args.start, args.end);
    const delta = { x: args.end.x - args.start.x, y: args.end.y - args.start.y };
    const travelTangent = normalizePoint(delta);
    const startControlDistance = Math.max(
        48,
        Math.min(640, distance * PATH_CONFIG.startHandle, distance * 0.9)
    );
    const endControlDistance = Math.max(
        48,
        Math.min(640, distance * PATH_CONFIG.endpointHandle, distance * 0.9)
    );
    const endTangent = { x: -clickTangent.x, y: -clickTangent.y };
    const startControl = advanceWithinBounds(
        args.bounds,
        args.start,
        clickTangent,
        startControlDistance
    );
    const endControl = advanceWithinBounds(args.bounds, args.end, endTangent, endControlDistance);
    const normal = { x: -travelTangent.y, y: travelTangent.x };
    const normalSign = normal.x * clickTangent.x + normal.y * clickTangent.y >= 0 ? 1 : -1;
    const naturalArcNormal = { x: normal.x * normalSign, y: normal.y * normalSign };
    const midpoint = midpointBetween(args.start, args.end);
    const compactStartControl = advanceWithinBounds(
        args.bounds,
        args.start,
        clickTangent,
        startControlDistance * 0.65
    );
    const compactEndControl = advanceWithinBounds(
        args.bounds,
        args.end,
        endTangent,
        endControlDistance * 0.65
    );
    const arcDistance = Math.max(50, Math.min(520, distance * PATH_CONFIG.arcSize));
    const arcHandleDistance = Math.max(38, Math.min(440, distance * PATH_CONFIG.arcFlow));
    const arcDistanceScales = [0.55, 0.8, 1.05];
    const arcHandleScales = [0.65, 1, 1.35];
    const candidates = [
        directBezierPath(args.start, args.end, startControl, endControl),
        directBezierPath(args.start, args.end, compactStartControl, compactEndControl),
    ];

    for (const arcDistanceScale of arcDistanceScales) {
        for (const arcHandleScale of arcHandleScales) {
            addArcCandidates({
                arcDistance,
                arcDistanceScale,
                arcHandleDistance,
                arcHandleScale,
                candidates,
                clickTangent,
                end: args.end,
                endControl,
                midpoint,
                naturalArcNormal,
                start: args.start,
                startControl,
                startControlDistance,
                travelTangent,
            });
        }
    }

    return candidates.slice(0, PATH_CONFIG.candidateCount);
}

function addArcCandidates(args) {
    addArcCandidate({ ...args, arcNormal: args.naturalArcNormal });
    addArcCandidate({
        ...args,
        arcNormal: { x: -args.naturalArcNormal.x, y: -args.naturalArcNormal.y },
    });
}

function addArcCandidate(args) {
    const arcOffset = args.arcDistance * args.arcDistanceScale;
    const arcHandle = args.arcHandleDistance * args.arcHandleScale;
    const arc = {
        x:
            args.midpoint.x +
            args.arcNormal.x * arcOffset +
            args.clickTangent.x * args.startControlDistance * 0.16,
        y:
            args.midpoint.y +
            args.arcNormal.y * arcOffset +
            args.clickTangent.y * args.startControlDistance * 0.16,
    };
    const arcIn = {
        x: arc.x - args.travelTangent.x * arcHandle,
        y: arc.y - args.travelTangent.y * arcHandle,
    };
    const arcOut = {
        x: arc.x + args.travelTangent.x * arcHandle,
        y: arc.y + args.travelTangent.y * arcHandle,
    };

    args.candidates.push(
        arcBezierPath({
            arc,
            arcIn,
            arcOut,
            end: args.end,
            endControl: args.endControl,
            start: args.start,
            startControl: args.startControl,
        })
    );
}

function directBezierPath(start, end, startControl, endControl) {
    return {
        arc: null,
        arcIn: null,
        arcOut: null,
        end,
        endControl,
        mode: 'bezier',
        segments: [{ control1: startControl, control2: endControl, end }],
        start,
        startControl,
    };
}

function arcBezierPath(args) {
    return {
        arc: args.arc,
        arcIn: args.arcIn,
        arcOut: args.arcOut,
        end: args.end,
        endControl: args.endControl,
        mode: 'bezier',
        segments: [
            { control1: args.startControl, control2: args.arcIn, end: args.arc },
            { control1: args.arcOut, control2: args.endControl, end: args.end },
        ],
        start: args.start,
        startControl: args.startControl,
    };
}

function selectBezierCandidate(candidates, bounds) {
    const first = candidates[0];
    if (!first) throw new Error('Cursor motion requires at least one candidate');

    let bestInBounds = first;
    let bestInBoundsScore = Number.POSITIVE_INFINITY;
    let bestOverall = first;
    let bestOverallScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const metrics = pathMetrics(candidate, bounds);
        const score = pathScore(candidate, metrics);
        if (score < bestOverallScore) {
            bestOverall = candidate;
            bestOverallScore = score;
        }
        if (metrics.staysInBounds && score < bestInBoundsScore) {
            bestInBounds = candidate;
            bestInBoundsScore = score;
        }
    }

    return bestInBoundsScore === Number.POSITIVE_INFINITY ? bestOverall : bestInBounds;
}

function pathMetrics(path, bounds) {
    let length = 0;
    let angleChangeEnergy = 0;
    let maxAngleChange = 0;
    let totalTurn = 0;
    let previousAngle = null;
    let segmentStart = path.start;
    let previousPoint = path.start;
    let staysInBounds =
        bounds == null || pointInsideBounds(path.start, bounds, PATH_CONFIG.boundsMargin);

    for (const segment of path.segments) {
        for (let step = 1; step <= 24; step += 1) {
            const point = cubicPoint(
                segmentStart,
                segment.control1,
                segment.control2,
                segment.end,
                step / 24
            );
            length += pointDistance(previousPoint, point);
            if (bounds)
                staysInBounds =
                    staysInBounds && pointInsideBounds(point, bounds, PATH_CONFIG.boundsMargin);

            const delta = { x: point.x - previousPoint.x, y: point.y - previousPoint.y };
            if (pointDistance({ x: 0, y: 0 }, delta) > 0.01) {
                const angle = Math.atan2(delta.y, delta.x);
                if (previousAngle != null) {
                    const change = angleDeltaRadians(previousAngle, angle);
                    angleChangeEnergy += change * change;
                    maxAngleChange = Math.max(maxAngleChange, Math.abs(change));
                    totalTurn += Math.abs(change);
                }
                previousAngle = angle;
            }

            previousPoint = point;
        }
        segmentStart = segment.end;
    }

    return { angleChangeEnergy, length, maxAngleChange, staysInBounds, totalTurn };
}

function pathScore(path, metrics) {
    const directDistance = Math.max(1, pointDistance(path.start, path.end));
    const extraLengthRatio = Math.max(0, metrics.length / directDistance - 1);
    const arcPenalty = path.arc == null ? 0 : 45;
    return (
        metrics.length +
        extraLengthRatio * 320 +
        metrics.angleChangeEnergy * 140 +
        metrics.maxAngleChange * 180 +
        metrics.totalTurn * 18 +
        pathStartAlignmentPenalty(path) * 90 +
        arcPenalty
    );
}

function pathStartAlignmentPenalty(path) {
    const clickTangent = degreesToPoint(PATH_CONFIG.clickAngleDegrees);
    const travelTangent = normalizePoint({
        x: path.end.x - path.start.x,
        y: path.end.y - path.start.y,
    });
    return clamp(
        (-(travelTangent.x * clickTangent.x + travelTangent.y * clickTangent.y) - 0.08) / 0.92,
        0,
        1
    );
}

function createMotionState(point, visible, now) {
    return {
        arrivedKey: null,
        cursorKey: null,
        moveSequence: null,
        motion: null,
        point,
        positionXSpring: spring(point.x, point.x, RESPONSE.position, DAMPING.position),
        positionYSpring: spring(point.y, point.y, RESPONSE.position, DAMPING.position),
        rotation: DEFAULT_ROTATION,
        rotationSpring: spring(
            DEFAULT_ROTATION,
            DEFAULT_ROTATION,
            RESPONSE.rotation,
            DAMPING.rotation
        ),
        scootAxisRotation: 0,
        scootAxisSpring: spring(0, 0, RESPONSE.rotation, DAMPING.rotation),
        scootRotationSpring: spring(0, 0, RESPONSE.scootRotation, DAMPING.scootRotation),
        scootStretchSpring: spring(1, 1, RESPONSE.scootStretch, DAMPING.scootStretch),
        stretchSpring: spring(1, 1, RESPONSE.stretch, DAMPING.stretch),
        visibilitySpring: spring(
            visible ? 1 : 0,
            visible ? 1 : 0,
            RESPONSE.visibility,
            DAMPING.visibility
        ),
        lastTime: now,
        thinkStartedAt: null,
        thinkTurnKey: null,
    };
}

function stepPosition(state, deltaSeconds) {
    const previous = state.point;
    stepSpring(state.positionXSpring, deltaSeconds);
    stepSpring(state.positionYSpring, deltaSeconds);
    stepSpring(state.rotationSpring, deltaSeconds);
    stepSpring(state.scootAxisSpring, deltaSeconds);
    const point = { x: state.positionXSpring.value, y: state.positionYSpring.value };
    state.point = point;
    state.rotation = state.rotationSpring.value;
    state.scootAxisRotation = state.scootAxisSpring.value;
    return {
        point,
        speed: pointDistance(previous, point) / Math.max(deltaSeconds, SPRING_STEP_SECONDS),
    };
}

function snapToPoint(state, point) {
    state.point = point;
    resetSpring(state.positionXSpring, point.x);
    resetSpring(state.positionYSpring, point.y);
    resetSpring(state.rotationSpring, DEFAULT_ROTATION);
    state.rotation = DEFAULT_ROTATION;
    resetScoot(state);
    resetSpring(state.stretchSpring, 1);
}

function resetScoot(state) {
    resetSpring(state.scootAxisSpring, 0);
    resetSpring(state.scootRotationSpring, 0);
    resetSpring(state.scootStretchSpring, 1);
    state.scootAxisRotation = 0;
}

function pointArrived(state, target) {
    return (
        pointDistance(state.point, target) <= ARRIVAL_DISTANCE_PX &&
        Math.abs(state.positionXSpring.velocity) <= ARRIVAL_VELOCITY_PX &&
        Math.abs(state.positionYSpring.velocity) <= ARRIVAL_VELOCITY_PX
    );
}

function isMoving(state) {
    return (
        state.motion != null ||
        state.thinkStartedAt != null ||
        !springSettled(state.positionXSpring) ||
        !springSettled(state.positionYSpring) ||
        !springSettled(state.rotationSpring) ||
        !springSettled(state.scootAxisSpring) ||
        !springSettled(state.scootRotationSpring) ||
        !springSettled(state.scootStretchSpring) ||
        !springSettled(state.stretchSpring) ||
        !springSettled(state.visibilitySpring)
    );
}

function sampleBezierPath(path, progress) {
    const scaled = progress >= 1 ? path.segments.length - 1 : progress * path.segments.length;
    const index = Math.floor(scaled);
    const segment = path.segments[index] ?? path.segments[path.segments.length - 1];
    const previous = index === 0 ? path.start : path.segments[index - 1].end;
    const local = progress >= 1 ? 1 : scaled - index;
    return {
        point: cubicPoint(previous, segment.control1, segment.control2, segment.end, local),
        tangent: cubicTangent(previous, segment.control1, segment.control2, segment.end, local),
    };
}

function cubicPoint(start, control1, control2, end, t) {
    const inverse = 1 - t;
    return {
        x:
            start.x * inverse ** 3 +
            3 * control1.x * inverse ** 2 * t +
            3 * control2.x * inverse * t ** 2 +
            end.x * t ** 3,
        y:
            start.y * inverse ** 3 +
            3 * control1.y * inverse ** 2 * t +
            3 * control2.y * inverse * t ** 2 +
            end.y * t ** 3,
    };
}

function cubicTangent(start, control1, control2, end, t) {
    const inverse = 1 - t;
    return {
        x:
            3 * inverse ** 2 * (control1.x - start.x) +
            6 * inverse * t * (control2.x - control1.x) +
            3 * t ** 2 * (end.x - control2.x),
        y:
            3 * inverse ** 2 * (control1.y - start.y) +
            6 * inverse * t * (control2.y - control1.y) +
            3 * t ** 2 * (end.y - control2.y),
    };
}

function rotationForTangent(tangent) {
    if (pointDistance({ x: 0, y: 0 }, tangent) < 0.001) return DEFAULT_ROTATION;
    const normalized = normalizePoint(tangent);
    return normalizeDegrees((Math.atan2(normalized.y, normalized.x) * 180) / Math.PI + 90);
}

function stretchForSpeed(speed) {
    return clamp(1 - speed / 5_500, 0.65, 1);
}

function bezierSpringResponse(path) {
    return {
        dampingFraction: BEZIER_DAMPING_FRACTION,
        response: pathSpringResponse(path),
    };
}

function pathSpringResponse(path) {
    const metrics = pathMetrics(path);
    const directDistance = Math.max(1, pointDistance(path.start, path.end));
    const extraLengthRatio = Math.max(0, metrics.length / directDistance - 1);
    const lengthAmount = clamp((metrics.length - 180) / 760, 0, 1);
    const extraLengthAmount = clamp(extraLengthRatio / 0.55, 0, 1);
    const turnAmount = clamp(metrics.totalTurn / (Math.PI * 1.4), 0, 1);
    const angleEnergyAmount = clamp(metrics.angleChangeEnergy / 1.25, 0, 1);
    const complexity = clamp(
        extraLengthAmount * 0.42 + turnAmount * 0.38 + angleEnergyAmount * 0.2,
        0,
        1
    );
    const alignment = pathStartAlignmentPenalty(path) * 0.28;
    const arcBonus = path.arc == null ? 0 : 0.04;
    const arcMultiplier = path.arc == null ? 1 : 0.9;
    return clamp(
        (0.42 + lengthAmount * 0.22 + complexity * 0.12 + alignment + arcBonus) *
            BEZIER_RESPONSE_SCALE *
            arcMultiplier,
        MIN_BEZIER_RESPONSE,
        MAX_BEZIER_RESPONSE
    );
}

function positionSpringResponse(pathResponse) {
    return clamp(pathResponse * 0.18, 0.035, 0.12);
}

function setPositionSpringResponse(state, response, dampingFraction) {
    state.positionXSpring.response = response;
    state.positionXSpring.dampingFraction = dampingFraction;
    state.positionYSpring.response = response;
    state.positionYSpring.dampingFraction = dampingFraction;
}

function currentRotation(state, now) {
    if (state.thinkStartedAt == null) return state.rotation;
    const elapsedSeconds = (now - state.thinkStartedAt) / 1_000;
    if (elapsedSeconds < 0) return state.rotation;

    const progress = Math.min(1, elapsedSeconds / THINK_DURATION_SECONDS);
    const envelope = Math.sin(progress * Math.PI);
    const offset =
        Math.sin((elapsedSeconds / THINK_PERIOD_SECONDS) * Math.PI * 2) *
        envelope *
        THINK_ROTATION_DEGREES;
    if (progress >= 1) {
        state.thinkStartedAt = null;
        return state.rotation;
    }
    return state.rotation + offset;
}

function spring(value, target, response, dampingFraction) {
    return {
        dampingFraction,
        force: 0,
        response,
        scriptTime: 0,
        simulationTime: 0,
        target,
        value,
        velocity: 0,
    };
}

function stepSpring(springState, deltaSeconds) {
    const response = Math.max(0.001, springState.response);
    const maxStiffness = 1 / (2 * SPRING_STEP_SECONDS ** 2);
    const stiffness = Math.min((Math.PI * 2) ** 2 / response ** 2, maxStiffness);
    const damping = Math.sqrt(stiffness) * 2 * springState.dampingFraction;

    springState.scriptTime += Math.max(0, deltaSeconds);
    if (springState.scriptTime - springState.simulationTime > MAX_SPRING_CATCHUP_SECONDS) {
        springState.simulationTime = springState.scriptTime - FRAME_SECONDS;
    }
    while (springState.simulationTime < springState.scriptTime) {
        integrateSpring(springState, stiffness, damping);
        springState.simulationTime += SPRING_STEP_SECONDS;
    }

    if (springSettled(springState)) springState.value = springState.target;
}

function springSettled(springState) {
    if (
        Math.max(
            springState.velocity * springState.velocity,
            springState.force * springState.force
        ) >
        SPRING_SETTLE_THRESHOLD ** 2
    ) {
        return false;
    }
    const tolerance = springState.target * 0.01;
    const delta = springState.target - springState.value;
    return tolerance === 0 || delta * delta <= tolerance * tolerance;
}

function integrateSpring(springState, stiffness, damping) {
    const halfStep = SPRING_STEP_SECONDS / 2;
    const velocity = springState.velocity + springState.force * halfStep;
    springState.value += velocity * SPRING_STEP_SECONDS;
    springState.force = velocity * -damping + (springState.target - springState.value) * stiffness;
    springState.velocity = velocity + springState.force * halfStep;
}

function resetSpring(springState, value) {
    springState.force = 0;
    springState.simulationTime = 0;
    springState.scriptTime = 0;
    springState.target = value;
    springState.value = value;
    springState.velocity = 0;
}

function setRotationalTarget(springState, target) {
    springState.target = springState.value + shortestAngle(springState.value, target);
}

function cursorPoint(cursor, viewportSize) {
    const fallback = {
        x: Math.round(viewportSize.width * FALLBACK_X_RATIO),
        y: Math.round(viewportSize.height * FALLBACK_Y_RATIO),
    };
    return {
        x: clamp(cursor?.x ?? fallback.x, 0, viewportSize.width),
        y: clamp(cursor?.y ?? fallback.y, 0, viewportSize.height),
    };
}

function advanceWithinBounds(bounds, point, direction, distance) {
    let usableDistance = distance;
    if (direction.x < 0) usableDistance = Math.min(usableDistance, point.x / -direction.x);
    if (direction.x > 0)
        usableDistance = Math.min(usableDistance, (bounds.width - point.x) / direction.x);
    if (direction.y < 0) usableDistance = Math.min(usableDistance, point.y / -direction.y);
    if (direction.y > 0)
        usableDistance = Math.min(usableDistance, (bounds.height - point.y) / direction.y);
    return {
        x: point.x + direction.x * Math.max(0, usableDistance),
        y: point.y + direction.y * Math.max(0, usableDistance),
    };
}

function midpointBetween(start, end) {
    return {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
    };
}

function pointInsideBounds(point, bounds, margin) {
    return (
        point.x >= margin &&
        point.x <= bounds.width - margin &&
        point.y >= margin &&
        point.y <= bounds.height - margin
    );
}

function angleDeltaRadians(from, to) {
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
}

function degreesToPoint(degrees) {
    const radians = (degrees * Math.PI) / 180;
    return {
        x: Math.sin(radians),
        y: -Math.cos(radians),
    };
}

function normalizePoint(point) {
    const distance = pointDistance({ x: 0, y: 0 }, point);
    return distance < 0.001 ? { x: 1, y: 0 } : { x: point.x / distance, y: point.y / distance };
}

function progressBetween(point, start, end) {
    const delta = { x: end.x - start.x, y: end.y - start.y };
    const lengthSquared = delta.x ** 2 + delta.y ** 2;
    if (lengthSquared < 0.001) return 1;
    return clamp(
        ((point.x - start.x) * delta.x + (point.y - start.y) * delta.y) / lengthSquared,
        0,
        1
    );
}

function pointDistance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function shortestAngle(from, to) {
    let delta = to - from;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
}

function normalizeDegrees(degrees) {
    const normalized = degrees % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function interpolate(start, end, progress) {
    return start + (end - start) * progress;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function round(value) {
    return Math.round(value * 1_000) / 1_000;
}

function currentTime() {
    return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function emptyFrame() {
    return {
        arrivedMoveSequence: null,
        filter: 'blur(5px)',
        opacity: '0',
        shouldContinue: false,
        transform: `translate3d(0px, 0px, 0) rotate(${DEFAULT_ROTATION}deg) scale(1, 1)`,
    };
}

function viewportSize() {
    return {
        height: window.visualViewport?.height ?? window.innerHeight,
        width: window.visualViewport?.width ?? window.innerWidth,
    };
}

function cssText() {
    return `
    .gemini-nexus-cursor-overlay {
      all: initial;
      position: fixed;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      z-index: 2147483646;
    }
    .gemini-nexus-cursor {
      position: absolute;
      top: 0;
      left: 0;
      width: ${CURSOR_SIZE}px;
      height: ${CURSOR_SIZE}px;
      opacity: 0;
      transform-origin: ${CURSOR_SIZE / 2}px ${CURSOR_SIZE / 2}px;
      will-change: transform, opacity;
    }
    .gemini-nexus-cursor img {
      display: block;
      transform: translate3d(12px, -2.5px, 0) rotate(44deg);
      transform-origin: 0 0;
      filter: drop-shadow(0 0 6px rgba(51, 156, 255, 0.9))
        drop-shadow(0 0 15px rgba(51, 156, 255, 0.48));
    }
    @media print {
      .gemini-nexus-cursor-overlay {
        display: none;
      }
    }
  `;
}

(function initCursorOverlay() {
    if (window.top !== window.self) return;
    if (window.__geminiNexusCursorInstalled) return;
    window.__geminiNexusCursorInstalled = true;

    const overlay = new CursorOverlay((moveSequence) => {
        chrome.runtime.sendMessage({ action: 'CURSOR_ARRIVED', moveSequence }).catch(() => {});
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || typeof message.action !== 'string') return false;
        switch (message.action) {
            case 'CURSOR_PING':
                sendResponse({ ok: true });
                return true;
            case 'CURSOR_MOVE':
                overlay.setState({
                    cursor: {
                        x: message.x,
                        y: message.y,
                        visible: true,
                        moveSequence: message.moveSequence,
                        animateMovement: message.animate !== false,
                    },
                    isVisible: true,
                    sessionId: 'gn',
                    turnId: '',
                });
                sendResponse({ ok: true });
                return true;
            case 'CURSOR_HIDE':
                overlay.setState({
                    cursor: null,
                    isVisible: false,
                    sessionId: null,
                    turnId: null,
                });
                sendResponse({ ok: true });
                return true;
            case 'CURSOR_THINK':
                // Control session is active but the agent has no target coordinate
                // yet — drive the overlay into its "thinking" wobble (cursor:null +
                // a fresh turnId so thinkTurnKey changes and the wobble (re)starts).
                overlay.setState({
                    cursor: null,
                    isVisible: true,
                    sessionId: 'gn',
                    turnId: String(message.turnId ?? ''),
                });
                sendResponse({ ok: true });
                return true;
            default:
                return false;
        }
    });

    window.addEventListener('resize', () => overlay.render());
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => overlay.render());
    }
})();
