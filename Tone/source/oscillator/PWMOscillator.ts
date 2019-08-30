import { Cents, Degrees, Frequency, Time } from "../../core/type/Units";
import { optionsFromArguments } from "../../core/util/Defaults";
import { readOnly } from "../../core/util/Interface";
import { Multiply } from "../../signal/Multiply";
import { Signal } from "../../signal/Signal";
import { Source } from "../Source";
import { Oscillator } from "./Oscillator";
import { PWMOscillatorOptions, ToneOscillatorInterface } from "./OscillatorInterface";
import { PulseOscillator } from "./PulseOscillator";

/**
 * PWMOscillator modulates the width of a Tone.PulseOscillator
 * at the modulationFrequency. This has the effect of continuously
 * changing the timbre of the oscillator by altering the harmonics
 * generated.
 * @example
 *  var pwm = new PWMOscillator("Ab3", 0.3).toDestination().start();
 */
export class PWMOscillator extends Source<PWMOscillatorOptions> implements ToneOscillatorInterface {

	readonly name = "PWMOscillator";

	readonly sourceType = "pwm";

	/**
	 *  the pulse oscillator
	 */
	private _pulse: PulseOscillator;
	/**
	 *  the modulator
	 */
	private _modulator: Oscillator;

	/**
	 *  Scale the oscillator so it doesn't go silent
	 *  at the extreme values.
	 */
	private _scale: Multiply = new Multiply({
		context: this.context,
		value: 2,
	});

	/**
	 *  The frequency control.
	 */
	readonly frequency: Signal<Frequency>;

	/**
	 *  The detune of the oscillator.
	 */
	readonly detune: Signal<Cents>;

	/**
	 *  The modulation rate of the oscillator.
	 */
	readonly modulationFrequency: Signal<Frequency>;

	/**
	 * @param {Frequency} frequency The starting frequency of the oscillator.
	 * @param {Frequency} modulationFrequency The modulation frequency of the width of the pulse.
	 */
	constructor(frequency?: Frequency, modulationFrequency?: Frequency);
	constructor(options?: Partial<PWMOscillatorOptions>);
	constructor() {
		super(optionsFromArguments(PWMOscillator.getDefaults(), arguments, ["frequency", "modulationFrequency"]));
		const options = optionsFromArguments(PWMOscillator.getDefaults(), arguments, ["frequency", "modulationFrequency"]);

		this._pulse = new PulseOscillator({
			context: this.context,
			frequency: options.modulationFrequency,
		});
		// change the pulse oscillator type
		// @ts-ignore
		this._pulse._sawtooth.type = "sine";

		this.modulationFrequency  = this._pulse.frequency;

		this._modulator = new Oscillator({
			context: this.context,
			detune: options.detune,
			frequency: options.frequency,
			onstop: () => this.onstop(this),
			phase: options.phase,
		});

		this.frequency = this._modulator.frequency;
		this.detune = this._modulator.detune;

		// connections
		this._modulator.chain(this._scale, this._pulse.width);
		this._pulse.connect(this.output);
		readOnly(this, ["modulationFrequency", "frequency", "detune"]);
	}

	static getDefaults(): PWMOscillatorOptions {
		return Object.assign(Source.getDefaults(), {
			detune: 0,
			frequency: 440,
			modulationFrequency: 0.4,
			phase: 0,
			type: "pwm" as "pwm",
		});
	}
	/**
	 *  start the oscillator
	 */
	protected _start(time: Time): void {
		time = this.toSeconds(time);
		this._modulator.start(time);
		this._pulse.start(time);
	}

	/**
	 *  stop the oscillator
	 */
	protected _stop(time: Time): void {
		time = this.toSeconds(time);
		this._modulator.stop(time);
		this._pulse.stop(time);
	}

	/**
	 *  restart the oscillator
	 */
	restart(time?: Time): this {
		this._modulator.restart(time);
		this._pulse.restart(time);
		return this;
	}

	/**
	 * The type of the oscillator. Always returns "pwm".
	 */
	get type(): "pwm" {
		return "pwm";
	}

	/**
	 * The baseType of the oscillator. Always returns "pwm".
	 */
	get baseType(): "pwm" {
		return "pwm";
	}

	/**
	 * The partials of the waveform. Cannot set partials for this waveform type
	 */
	get partials(): number[] {
		return [];
	}

	/**
	 * No partials for this waveform type.
	 */
	get partialCount(): number {
		return 0;
	}

	/**
	 * The phase of the oscillator in degrees.
	 */
	get phase(): Degrees {
		return this._modulator.phase;
	}
	set phase(phase: Degrees) {
		this._modulator.phase = phase;
	}

	/**
	 *  Clean up.
	 */
	dispose(): this {
		super.dispose();
		this._pulse.dispose();
		this._scale.dispose();
		this._modulator.dispose();
		return this;
	}
}