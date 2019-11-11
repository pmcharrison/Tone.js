import { Gain } from "../../core/context/Gain";
import { Param } from "../../core/context/Param";
import { connectSeries, ToneAudioNode, ToneAudioNodeOptions } from "../../core/context/ToneAudioNode";
import { NormalRange, Time } from "../../core/type/Units";
import { optionsFromArguments } from "../../core/util/Defaults";
import { readOnly, RecursivePartial } from "../../core/util/Interface";
import { ToneAudioWorklet } from "../../core/context/ToneAudioWorklet";

export interface FeedbackCombFilterOptions extends ToneAudioNodeOptions {
	delayTime: Time;
	resonance: NormalRange;
}

/**
 * Comb filters are basic building blocks for physical modeling. Read more
 * about comb filters on [CCRMA's website](https://ccrma.stanford.edu/~jos/pasp/Feedback_Comb_Filters.html).
 * 
 * This comb filter is implemented with the AudioWorkletNode which allows it to have feedback delays less than the 
 * Web Audio processing block of 128 samples. There is a polyfill for browsers that don't yet support the 
 * AudioWorkletNode, but it will add some latency and have slower performance than the AudioWorkletNode. 
 * @category Component
 */
export class FeedbackCombFilter extends ToneAudioWorklet<FeedbackCombFilterOptions> {
	
	readonly name = "FeedbackCombFilter";
	
	/**
	 * The amount of delay of the comb filter.
	 */
	readonly delayTime: Param<"time">;
	
	/**
	 * The amount of feedback of the delayed signal.
	 */
	readonly resonance: Param<"normalRange">;
	
	readonly input: Gain;
	readonly output: Gain;

	/**
	 * Default constructor options for the filter
	 */
	protected workletOptions: Partial<AudioWorkletNodeOptions> = {
		numberOfInputs: 1,
		numberOfOutputs: 1,
	}
	
	/**
	 * @param delayTime The delay time of the filter.
	 * @param resonance The amount of feedback the filter has.
	 */
	constructor(delayTime?: Time, resonance?: NormalRange);
	constructor(options?: RecursivePartial<FeedbackCombFilterOptions>);
	constructor() {
		super(optionsFromArguments(FeedbackCombFilter.getDefaults(), arguments, ["delayTime", "resonance"]));
		const options = optionsFromArguments(FeedbackCombFilter.getDefaults(), arguments, ["delayTime", "resonance"]);

		this.input = new Gain({ context: this.context });
		this.output = new Gain({ context: this.context });

		const dummyGain = this.context.createGain();

		this.delayTime = new Param<"time">({
			context: this.context,
			value: options.delayTime,
			units: "time",
			minValue: 0,
			maxValue: 1,
			param: dummyGain.gain,
			swappable: true,
		});
		
		this.resonance = new Param<"normalRange">({
			context: this.context,
			value: options.resonance,
			units: "normalRange",
			param: dummyGain.gain,
			swappable: true,
		});

		readOnly(this, ["resonance", "delayTime"]);
	}

	protected _audioWorkletName(): string {
		return "feedback-comb-filter";
	}

	protected _audioWorklet(): string {
		return /* javascript */` 
			registerProcessor("${this._audioWorkletName()}", class extends AudioWorkletProcessor {
				static get parameterDescriptors() {
					return [{
						name: "delayTime",
						defaultValue: 0.1,
						minValue: 0,
						maxValue: 1,
					},
					{
						name: "feedback",
						defaultValue: 0.5,
						minValue: 0,
						maxValue: 0.9999,
					}];
				}
			
				constructor(options) {
					super(options);
					this.delayBuffer = new Float32Array(sampleRate);
				}
			
				getParameter(name, index, parameters) {
					if (parameters[name].length > 1) {
						return parameters[name][index];
					} else {
						return parameters[name][0];
					}
				}
			
				process(inputs, outputs, parameters) {
					const input = inputs[0];
					const output = outputs[0];
					if (input && output) {
						const delayLength = this.delayBuffer.length;
						input.forEach((inputChannel, channelNum) => {
							inputChannel.forEach((value, index) => {
								const delayTime = this.getParameter("delayTime", index, parameters);
								const feedback = this.getParameter("feedback", index, parameters);
								const delaySamples = Math.floor(delayTime * sampleRate);
								const currentIndex = (currentFrame + index) % delayLength;
								const delayedIndex = (currentFrame + index + delaySamples) % delayLength;
								
								// the current value to output
								const currentValue = this.delayBuffer[currentIndex];
								
								// write the current value to the delayBuffer in the future
								this.delayBuffer[delayedIndex] = value + currentValue * feedback;
			
								// set all of the output channels to the same value
								output[channelNum][index] = delaySamples > 0 ? currentValue : value;
							});
						});
						return true;
					}
					return true;
				}
			});
		`;
	}

	/**
	 * The default parameters
	 */
	static getDefaults(): FeedbackCombFilterOptions {
		return Object.assign(ToneAudioNode.getDefaults(), {
			delayTime: 0.1,
			resonance: 0.5,
		});
	}

	onReady(node: AudioWorkletNode) {
		connectSeries(this.input, node, this.output);
		// @ts-ignore
		const delayTime = node.parameters.get("delayTime");
		this.delayTime.setParam(delayTime);
		// @ts-ignore
		const feedback = node.parameters.get("feedback");
		this.resonance.setParam(feedback);
	}

	dispose(): this {
		super.dispose();
		this.input.dispose();
		this.output.dispose();
		this.delayTime.dispose();
		this.resonance.dispose();
		return this;
	}
}
