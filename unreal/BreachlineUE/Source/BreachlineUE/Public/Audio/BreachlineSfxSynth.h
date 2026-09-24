// Copyright (c) Breachline UE. All rights reserved.
//
// Procedural SFX synth: the whole game's combat audio without a single asset.
//
// This is a direct port of the web prototype's Web Audio engine to
// USynthComponent::OnGenerateAudio — fixed voice pool, per-voice biquad filter,
// ADSR envelope, oscillator + noise layers. Every weapon sounds different
// because its FWeaponSoundSignature says so, and a sound designer can replace
// any cue with a MetaSound later without touching gameplay code.

#pragma once

#include "CoreMinimal.h"
#include "Components/SynthComponent.h"
#include "Core/BreachlineTypes.h"
#include "BreachlineSfxSynth.generated.h"

UENUM()
enum class ESfxVoiceType : uint8
{
	Noise,
	Sine,
	Triangle,
	Square,
	Sawtooth
};

/** One synthesized sound event. */
struct FBreachlineSfxVoice
{
	bool bActive = false;
	ESfxVoiceType Type = ESfxVoiceType::Noise;

	// Oscillator / noise
	float FreqStart = 440.f;
	float FreqEnd = 440.f;
	float NoiseCutoff = 2000.f;
	ENoiseFilterType Filter = ENoiseFilterType::BandPass;
	float FilterQ = 1.2f;

	// Envelope (in samples)
	int64 DurationSamples = 0;
	int64 AttackSamples = 0;
	int64 Position = 0;

	float Gain = 0.5f;
	float Pan = 0.f;
	/** Distance attenuation applied by the audio subsystem (0..1). */
	float DistanceGain = 1.f;

	// Biquad state (direct-form 2 transposed)
	float Z1 = 0.f;
	float Z2 = 0.f;
};

UCLASS(ClassGroup = (Breachline), meta = (BlueprintSpawnableComponent))
class BREACHLINEUE_API UBreachlineSfxSynth : public USynthComponent
{
	GENERATED_BODY()

public:
	UBreachlineSfxSynth();

	// --- event API (all cheap; they just book voices) -----------------------
	void PlayShot(const FWeaponSoundSignature& Signature, float Gain, float Pan, float DistanceGain);
	void PlayReload(const FBreachlineWeaponDef& Weapon, bool bStart, float Gain, float Pan);
	void PlayFootstep(bool bRunning, float Gain, float Pan);
	void PlayImpact(bool bFlesh, bool bMetal, float Gain, float Pan);
	void PlayNearMiss(float Gain, float Pan);
	void PlayExplosion(float Gain, float Pan);
	void PlayPickup(float Gain, float Pan);
	void PlayDryFire(float Gain, float Pan);
	void PlayUi(bool bConfirm, float Gain = 1.f);

	/** Ambient bed: wind + sub drone, always on while playing. */
	void SetAmbientEnabled(bool bEnabled) { bAmbient = bEnabled; }
	void SetAmbientLevel(float Level) { AmbientLevel = FMath::Clamp(Level, 0.f, 1.f); }
	void SetMasterGain(float Gain) { MasterGain = FMath::Clamp(Gain, 0.f, 1.f); }

	int32 GetActiveVoiceCount() const;

protected:
	virtual bool Init(int32& SampleRate) override;
	virtual int32 OnGenerateAudio(float* OutAudio, int32 NumSamples) override;

private:
	FBreachlineSfxVoice* AllocateVoice();
	float NextNoise();

	/** Fixed pool: DSP never allocates on the audio thread. */
	static constexpr int32 MaxVoices = 48;
	FBreachlineSfxVoice Voices[MaxVoices];

	int32 SampleRateHz = 48000;
	float MasterGain = 1.f;
	float AmbientLevel = 0.6f;
	bool bAmbient = false;

	// Ambient bed state.
	float AmbientPhase = 0.f;
	float WindState = 0.f;
	uint32 NoiseState = 0x1234567u;
};
