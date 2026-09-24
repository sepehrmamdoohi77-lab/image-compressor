// Copyright (c) Breachline UE. All rights reserved.

#include "Audio/BreachlineSfxSynth.h"
#include "Core/BreachlineBalance.h"

UBreachlineSfxSynth::UBreachlineSfxSynth()
{
	// Spatialisation is done per-voice (pan + distance gain), so the component
	// itself stays a plain 2-channel source: one synth, many sources, no
	// per-shot component churn.
	bAllowSpatialization = false;
	NumChannels = 2;
	bAutoActivate = true;
	PrimaryComponentTick.bCanEverTick = false;
}

bool UBreachlineSfxSynth::Init(int32& SampleRate)
{
	SampleRateHz = SampleRate > 0 ? SampleRate : 48000;
	for (FBreachlineSfxVoice& Voice : Voices)
	{
		Voice = FBreachlineSfxVoice();
	}
	return true;
}

float UBreachlineSfxSynth::NextNoise()
{
	// xorshift32: cheap and uniform enough for noise layers. Per-instance state
	// means two synths never correlate into an audible "phaser".
	NoiseState ^= NoiseState << 13;
	NoiseState ^= NoiseState >> 17;
	NoiseState ^= NoiseState << 5;
	return float(int32(NoiseState)) / float(INT32_MAX);
}

FBreachlineSfxVoice* UBreachlineSfxSynth::AllocateVoice()
{
	// Prefer an idle slot; otherwise steal the oldest (smallest remaining life).
	FBreachlineSfxVoice* Oldest = nullptr;
	int64 BestRemaining = TNumericLimits<int64>::Max();

	for (FBreachlineSfxVoice& Voice : Voices)
	{
		if (!Voice.bActive)
		{
			return &Voice;
		}
		const int64 Remaining = Voice.DurationSamples - Voice.Position;
		if (Remaining < BestRemaining)
		{
			BestRemaining = Remaining;
			Oldest = &Voice;
		}
	}
	return Oldest;
}

int32 UBreachlineSfxSynth::GetActiveVoiceCount() const
{
	int32 Count = 0;
	for (const FBreachlineSfxVoice& Voice : Voices)
	{
		Count += Voice.bActive ? 1 : 0;
	}
	return Count;
}

void UBreachlineSfxSynth::PlayShot(const FWeaponSoundSignature& S, float Gain, float Pan, float DistanceGain)
{
	const int32 SampleRate = SampleRateHz;
	const float Duration = FMath::Max(0.02f, S.Duration);
	const int64 Samples = int64(Duration * SampleRate);

	// Layer 1 — the noise crack, filtered to the weapon's character.
	if (FBreachlineSfxVoice* Noise = AllocateVoice())
	{
		*Noise = FBreachlineSfxVoice();
		Noise->bActive = true;
		Noise->Type = ESfxVoiceType::Noise;
		Noise->Filter = S.NoiseFilter;
		Noise->NoiseCutoff = S.NoiseFreq;
		Noise->FilterQ = 1.1f;
		Noise->DurationSamples = Samples;
		Noise->AttackSamples = int64(0.0015f * SampleRate);
		Noise->Gain = Gain * 0.9f;
		Noise->Pan = Pan;
		Noise->DistanceGain = DistanceGain;
	}

	// Layer 2 — the body thump (square with a fast downward sweep).
	if (FBreachlineSfxVoice* Body = AllocateVoice())
	{
		*Body = FBreachlineSfxVoice();
		Body->bActive = true;
		Body->Type = ESfxVoiceType::Square;
		Body->FreqStart = S.BodyFreq;
		Body->FreqEnd = S.BodyFreq * 0.55f;
		Body->Filter = ENoiseFilterType::LowPass;
		Body->NoiseCutoff = S.BodyFreq * 3.5f;
		Body->DurationSamples = int64(Samples * 0.7f);
		Body->AttackSamples = int64(0.0008f * SampleRate);
		Body->Gain = Gain * 0.55f;
		Body->Pan = Pan;
		Body->DistanceGain = DistanceGain;
	}

	// Layer 3 — the tail: a longer low noise wash that reads as distance down
	// the block. This is what makes a DMR "echo" and a pistol "dry".
	if (S.Tail > 0.02f && FBreachlineSfxVoice* Tail = AllocateVoice())
	{
		*Tail = FBreachlineSfxVoice();
		Tail->bActive = true;
		Tail->Type = ESfxVoiceType::Noise;
		Tail->Filter = ENoiseFilterType::LowPass;
		Tail->NoiseCutoff = FMath::Max(320.f, S.NoiseFreq * 0.45f);
		Tail->DurationSamples = int64(S.Tail * SampleRate);
		Tail->AttackSamples = int64(0.01f * SampleRate);
		Tail->Gain = Gain * 0.28f * (1.f - DistanceGain * 0.35f);
		Tail->Pan = Pan;
		Tail->DistanceGain = DistanceGain;
	}

	// Layer 4 — sub oscillator. Only the 12-gauge gets one; that is why it booms.
	if (S.bBig && FBreachlineSfxVoice* Sub = AllocateVoice())
	{
		*Sub = FBreachlineSfxVoice();
		Sub->bActive = true;
		Sub->Type = ESfxVoiceType::Sine;
		Sub->FreqStart = S.BodyFreq * 0.5f;
		Sub->FreqEnd = S.BodyFreq * 0.32f;
		Sub->DurationSamples = int64(FMath::Max(0.2f, S.Duration) * SampleRate);
		Sub->AttackSamples = int64(0.002f * SampleRate);
		Sub->Gain = Gain * 0.7f;
		Sub->Pan = Pan;
		Sub->DistanceGain = DistanceGain;
	}
}

void UBreachlineSfxSynth::PlayReload(const FBreachlineWeaponDef& Weapon, bool bStart, float Gain, float Pan)
{
	const int32 SampleRate = SampleRateHz;
	const float Mech = FMath::Clamp(Weapon.Sound.Mech, 0.1f, 1.f);

	// Per-class mechanical foley, scheduled as separate short voices so the
	// rhythm differs per weapon: pump-back/forward, bolt, or magazine slap.
	struct FClick { float Delay; float Freq; float Level; bool bMetal; };
	TArray<FClick> Clicks;

	if (bStart)
	{
		if (Weapon.bPump)
		{
			Clicks = { { 0.f, 2400.f, 0.34f, false }, { 0.18f, 1100.f, 0.44f, true }, { 0.42f, 1800.f, 0.40f, true } };
		}
		else if (Weapon.bBolt)
		{
			Clicks = { { 0.f, 2300.f, 0.32f, true }, { 0.2f, 2700.f, 0.36f, true } };
		}
		else
		{
			Clicks = { { 0.f, 2600.f, 0.30f, false }, { 0.22f, 1400.f, 0.40f, true } };
		}
	}
	else
	{
		// Magazine seating / bolt home: the "ready" beat.
		Clicks = { { 0.f, 1900.f, 0.30f, true }, { 0.12f, 3200.f, 0.24f, true } };
	}

	for (int32 Index = 0; Index < Clicks.Num(); ++Index)
	{
		const FClick& Click = Clicks[Index];
		// Voices fire immediately; spacing is expressed as a short delay inside
		// the envelope window by shortening duration and relying on the
		// sequencer-free design: the audio subsystem queues delay via voice count.
		if (FBreachlineSfxVoice* Voice = AllocateVoice())
		{
			*Voice = FBreachlineSfxVoice();
			Voice->bActive = true;
			Voice->Type = ESfxVoiceType::Noise;
			Voice->Filter = Click.bMetal ? ENoiseFilterType::HighPass : ENoiseFilterType::BandPass;
			Voice->NoiseCutoff = Click.Freq;
			Voice->FilterQ = 1.4f;
			Voice->DurationSamples = int64((Click.Delay > 0.f ? 0.06f : 0.09f) * SampleRate);
			Voice->AttackSamples = int64(0.001f * SampleRate);
			Voice->Gain = Gain * Click.Level * Mech;
			Voice->Pan = Pan;
			Voice->Position = -int64(Click.Delay * SampleRate); // negative = delay
		}
	}
}

void UBreachlineSfxSynth::PlayFootstep(bool bRunning, float Gain, float Pan)
{
	if (FBreachlineSfxVoice* Voice = AllocateVoice())
	{
		*Voice = FBreachlineSfxVoice();
		Voice->bActive = true;
		Voice->Type = ESfxVoiceType::Noise;
		Voice->Filter = ENoiseFilterType::LowPass;
		Voice->NoiseCutoff = bRunning ? 900.f : 700.f;
		Voice->DurationSamples = int64(0.07f * SampleRateHz);
		Voice->Gain = Gain * (bRunning ? 0.5f : 0.34f);
		Voice->Pan = Pan;
	}
}

void UBreachlineSfxSynth::PlayImpact(bool bFlesh, bool bMetal, float Gain, float Pan)
{
	if (FBreachlineSfxVoice* Voice = AllocateVoice())
	{
		*Voice = FBreachlineSfxVoice();
		Voice->bActive = true;
		Voice->Type = ESfxVoiceType::Noise;
		Voice->Filter = bMetal ? ENoiseFilterType::HighPass : ENoiseFilterType::BandPass;
		Voice->NoiseCutoff = bFlesh ? 600.f : (bMetal ? 3200.f : 1400.f);
		Voice->DurationSamples = int64((bFlesh ? 0.06f : 0.09f) * SampleRateHz);
		Voice->Gain = Gain * (bFlesh ? 0.4f : 0.5f);
		Voice->Pan = Pan;
	}
}

void UBreachlineSfxSynth::PlayNearMiss(float Gain, float Pan)
{
	// The whiz: a fast, narrow band of noise sweeping downward — the classic
	// "round cracked past" cue that tells the player to break line of sight.
	if (FBreachlineSfxVoice* Voice = AllocateVoice())
	{
		*Voice = FBreachlineSfxVoice();
		Voice->bActive = true;
		Voice->Type = ESfxVoiceType::Noise;
		Voice->Filter = ENoiseFilterType::BandPass;
		Voice->NoiseCutoff = 2600.f;
		Voice->FilterQ = 6.f;
		Voice->FreqStart = 2600.f;
		Voice->FreqEnd = 900.f;
		Voice->DurationSamples = int64(0.14f * SampleRateHz);
		Voice->AttackSamples = int64(0.006f * SampleRateHz);
		Voice->Gain = Gain * 0.55f;
		Voice->Pan = Pan;
	}
}

void UBreachlineSfxSynth::PlayExplosion(float Gain, float Pan)
{
	if (FBreachlineSfxVoice* Noise = AllocateVoice())
	{
		*Noise = FBreachlineSfxVoice();
		Noise->bActive = true;
		Noise->Type = ESfxVoiceType::Noise;
		Noise->Filter = ENoiseFilterType::LowPass;
		Noise->NoiseCutoff = 900.f;
		Noise->DurationSamples = int64(1.1f * SampleRateHz);
		Noise->AttackSamples = int64(0.004f * SampleRateHz);
		Noise->Gain = Gain;
		Noise->Pan = Pan;
	}
	if (FBreachlineSfxVoice* Sub = AllocateVoice())
	{
		*Sub = FBreachlineSfxVoice();
		Sub->bActive = true;
		Sub->Type = ESfxVoiceType::Sine;
		Sub->FreqStart = 110.f;
		Sub->FreqEnd = 28.f;
		Sub->DurationSamples = int64(0.9f * SampleRateHz);
		Sub->Gain = Gain * 1.1f;
		Sub->Pan = Pan;
	}
	if (FBreachlineSfxVoice* Crack = AllocateVoice())
	{
		*Crack = FBreachlineSfxVoice();
		Crack->bActive = true;
		Crack->Type = ESfxVoiceType::Noise;
		Crack->Filter = ENoiseFilterType::HighPass;
		Crack->NoiseCutoff = 4000.f;
		Crack->DurationSamples = int64(0.22f * SampleRateHz);
		Crack->Gain = Gain * 0.35f;
		Crack->Pan = Pan;
	}
}

void UBreachlineSfxSynth::PlayPickup(float Gain, float Pan)
{
	// Bright two-note confirmation: 660 -> 1320 Hz triangle.
	if (FBreachlineSfxVoice* A = AllocateVoice())
	{
		*A = FBreachlineSfxVoice();
		A->bActive = true;
		A->Type = ESfxVoiceType::Triangle;
		A->FreqStart = 660.f;
		A->FreqEnd = 990.f;
		A->DurationSamples = int64(0.16f * SampleRateHz);
		A->Gain = Gain * 0.35f;
		A->Pan = Pan;
	}
	if (FBreachlineSfxVoice* B = AllocateVoice())
	{
		*B = FBreachlineSfxVoice();
		B->bActive = true;
		B->Type = ESfxVoiceType::Triangle;
		B->FreqStart = 990.f;
		B->FreqEnd = 1320.f;
		B->DurationSamples = int64(0.18f * SampleRateHz);
		B->Gain = Gain * 0.28f;
		B->Pan = Pan;
		B->Position = -int64(0.1f * SampleRateHz);
	}
}

void UBreachlineSfxSynth::PlayDryFire(float Gain, float Pan)
{
	if (FBreachlineSfxVoice* Voice = AllocateVoice())
	{
		*Voice = FBreachlineSfxVoice();
		Voice->bActive = true;
		Voice->Type = ESfxVoiceType::Noise;
		Voice->Filter = ENoiseFilterType::HighPass;
		Voice->NoiseCutoff = 2600.f;
		Voice->DurationSamples = int64(0.05f * SampleRateHz);
		Voice->Gain = Gain * 0.4f;
		Voice->Pan = Pan;
	}
}

void UBreachlineSfxSynth::PlayUi(bool bConfirm, float Gain)
{
	if (FBreachlineSfxVoice* Voice = AllocateVoice())
	{
		*Voice = FBreachlineSfxVoice();
		Voice->bActive = true;
		Voice->Type = ESfxVoiceType::Sine;
		Voice->FreqStart = bConfirm ? 880.f : 420.f;
		Voice->FreqEnd = bConfirm ? 1180.f : 300.f;
		Voice->DurationSamples = int64(0.12f * SampleRateHz);
		Voice->Gain = Gain * 0.3f;
	}
}

int32 UBreachlineSfxSynth::OnGenerateAudio(float* OutAudio, int32 NumSamples)
{
	const float InvSampleRate = 1.f / float(SampleRateHz);

	for (int32 Frame = 0; Frame < NumSamples; ++Frame)
	{
		float Left = 0.f;
		float Right = 0.f;

		for (FBreachlineSfxVoice& Voice : Voices)
		{
			if (!Voice.bActive) continue;

			// Negative position = scheduled delay (used by reload foley).
			Voice.Position++;
			if (Voice.Position < 0)
			{
				continue;
			}
			if (Voice.Position > Voice.DurationSamples)
			{
				Voice.bActive = false;
				continue;
			}

			const float T = Voice.DurationSamples > 0
				? float(Voice.Position) / float(Voice.DurationSamples)
				: 1.f;

			// Envelope: fast attack, exponential-ish decay.
			float Env = 1.f;
			if (Voice.Position < Voice.AttackSamples && Voice.AttackSamples > 0)
			{
				Env = float(Voice.Position) / float(Voice.AttackSamples);
			}
			Env *= FMath::Square(1.f - T);

			// Oscillator / noise source with a frequency sweep for sweeps.
			const float Freq = FMath::Lerp(Voice.FreqStart, Voice.FreqEnd, T);
			float Sample = 0.f;
			switch (Voice.Type)
			{
			case ESfxVoiceType::Noise:
				Sample = NextNoise();
				break;
			case ESfxVoiceType::Sine:
				Sample = FMath::Sin(2.f * PI * Freq * float(Voice.Position) * InvSampleRate);
				break;
			case ESfxVoiceType::Triangle:
			{
				const float Phase = FMath::Fmod(Freq * float(Voice.Position) * InvSampleRate, 1.f);
				Sample = 4.f * FMath::Abs(Phase - 0.5f) - 1.f;
				break;
			}
			case ESfxVoiceType::Square:
			{
				const float Phase = FMath::Fmod(Freq * float(Voice.Position) * InvSampleRate, 1.f);
				Sample = Phase < 0.5f ? 1.f : -1.f;
				break;
			}
			case ESfxVoiceType::Sawtooth:
			{
				const float Phase = FMath::Fmod(Freq * float(Voice.Position) * InvSampleRate, 1.f);
				Sample = 2.f * Phase - 1.f;
				break;
			}
			}

			// Biquad filter (RBJ cookbook coefficients, state kept per voice).
			const float Omega = 2.f * PI * FMath::Clamp(Voice.NoiseCutoff, 20.f, float(SampleRateHz) * 0.45f) * InvSampleRate;
			const float SinO = FMath::Sin(Omega);
			const float CosO = FMath::Cos(Omega);
			const float Alpha = SinO / (2.f * FMath::Max(0.3f, Voice.FilterQ));

			float B0 = 1.f, B1 = 0.f, B2 = 0.f, A0 = 1.f, A1 = 0.f, A2 = 0.f;
			switch (Voice.Filter)
			{
			case ENoiseFilterType::LowPass:
				B0 = (1.f - CosO) * 0.5f; B1 = 1.f - CosO; B2 = B0;
				A0 = 1.f + Alpha; A1 = -2.f * CosO; A2 = 1.f - Alpha;
				break;
			case ENoiseFilterType::HighPass:
				B0 = (1.f + CosO) * 0.5f; B1 = -(1.f + CosO); B2 = B0;
				A0 = 1.f + Alpha; A1 = -2.f * CosO; A2 = 1.f - Alpha;
				break;
			case ENoiseFilterType::BandPass:
			default:
				B0 = Alpha; B1 = 0.f; B2 = -Alpha;
				A0 = 1.f + Alpha; A1 = -2.f * CosO; A2 = 1.f - Alpha;
				break;
			}

			const float InvA0 = 1.f / FMath::Max(1e-5f, A0);
			const float Filtered = (B0 * InvA0) * Sample + Voice.Z1;
			Voice.Z1 = (B1 * InvA0) * Sample - (A1 * InvA0) * Filtered + Voice.Z2;
			Voice.Z2 = (B2 * InvA0) * Sample - (A2 * InvA0) * Filtered;

			const float Value = Filtered * Env * Voice.Gain * Voice.DistanceGain;

			// Constant-power pan.
			const float Pan = FMath::Clamp(Voice.Pan, -1.f, 1.f);
			const float Angle = (Pan + 1.f) * 0.25f * PI;
			Left += Value * FMath::Cos(Angle);
			Right += Value * FMath::Sin(Angle);
		}

		// Ambient bed: filtered wind + a low drone. Cheap, always-on, and it
		// stops the arena from sounding like a vacuum.
		if (bAmbient)
		{
			const float Noise = NextNoise();
			WindState += (Noise - WindState) * 0.0016f;
			AmbientPhase += 2.f * PI * 55.f * InvSampleRate;
			if (AmbientPhase > 2.f * PI) AmbientPhase -= 2.f * PI;
			const float Drone = FMath::Sin(AmbientPhase) * 0.05f;
			const float Wind = WindState * 0.35f * (0.6f + 0.4f * FMath::Sin(AmbientPhase * 0.03f));
			Left += (Wind + Drone) * AmbientLevel;
			Right += (Wind * 0.85f + Drone) * AmbientLevel;
		}

		// Soft clip and write interleaved stereo.
		const float Master = MasterGain;
		OutAudio[Frame * 2] = FMath::Clamp(FMath::Tanh(Left * Master * 1.4f), -1.f, 1.f);
		OutAudio[Frame * 2 + 1] = FMath::Clamp(FMath::Tanh(Right * Master * 1.4f), -1.f, 1.f);
	}

	return NumSamples;
}
