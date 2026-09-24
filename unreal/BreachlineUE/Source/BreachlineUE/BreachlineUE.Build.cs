// Copyright (c) Breachline UE. All rights reserved.

using UnrealBuildTool;

public class BreachlineUE : ModuleRules
{
	public BreachlineUE(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		CppStandard = CppStandardVersion.Cpp20;
		bUseUnity = true;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",      // Enhanced Input (IMC/IA driven controls)
			"AIModule",           // AIController, Behaviour Trees, AI Perception
			"GameplayTasks",      // required by AIModule
			"NavigationSystem",   // navmesh queries, runtime bounds
			"Niagara",            // GPU VFX (tracers, impacts, muzzle flash, dust)
			"UMG",                // optional widget layer on top of the code HUD
			"Slate",
			"SlateCore",
			"AudioMixer",         // USynthComponent — procedural weapon/impact audio
			"DeveloperSettings",  // UBreachlineSettings (Project Settings page)
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"RenderCore",
			"RHI",
		});

		// Lumen / Substrate / MegaLights are configured through ini + post process,
		// never through code, so the module stays renderer-agnostic.
	}
}
