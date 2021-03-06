/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as Proto from '../protocol';
import * as PConst from '../protocol.const';
import { ITypeScriptServiceClient } from '../typescriptService';
import API from '../utils/api';
import { ConfigurationDependentRegistration, VersionDependentRegistration } from '../utils/dependentRegistration';
import * as typeConverters from '../utils/typeConverters';
import { CachedNavTreeResponse, ReferencesCodeLens, TypeScriptBaseCodeLensProvider } from './baseCodeLensProvider';
const localize = nls.loadMessageBundle();

export default class TypeScriptImplementationsCodeLensProvider extends TypeScriptBaseCodeLensProvider {

	public resolveCodeLens(inputCodeLens: vscode.CodeLens, token: vscode.CancellationToken): Promise<vscode.CodeLens> {
		const codeLens = inputCodeLens as ReferencesCodeLens;
		const args = typeConverters.Position.toFileLocationRequestArgs(codeLens.file, codeLens.range.start);
		return this.client.execute('implementation', args, token).then(response => {
			if (!response || !response.body) {
				throw codeLens;
			}

			const locations = response.body
				.map(reference =>
					// Only take first line on implementation: https://github.com/Microsoft/vscode/issues/23924
					new vscode.Location(this.client.asUrl(reference.file),
						reference.start.line === reference.end.line
							? typeConverters.Range.fromTextSpan(reference)
							: new vscode.Range(
								reference.start.line - 1, reference.start.offset - 1,
								reference.start.line, 0)))
				// Exclude original from implementations
				.filter(location =>
					!(location.uri.toString() === codeLens.document.toString() &&
						location.range.start.line === codeLens.range.start.line &&
						location.range.start.character === codeLens.range.start.character));

			codeLens.command = {
				title: locations.length === 1
					? localize('oneImplementationLabel', '1 implementation')
					: localize('manyImplementationLabel', '{0} implementations', locations.length),
				command: locations.length ? 'editor.action.showReferences' : '',
				arguments: [codeLens.document, codeLens.range.start, locations]
			};
			return codeLens;
		}).catch(() => {
			codeLens.command = {
				title: localize('implementationsErrorLabel', 'Could not determine implementations'),
				command: ''
			};
			return codeLens;
		});
	}

	protected extractSymbol(
		document: vscode.TextDocument,
		item: Proto.NavigationTree,
		_parent: Proto.NavigationTree | null
	): vscode.Range | null {
		switch (item.kind) {
			case PConst.Kind.interface:
				return super.getSymbolRange(document, item);

			case PConst.Kind.class:
			case PConst.Kind.memberFunction:
			case PConst.Kind.memberVariable:
			case PConst.Kind.memberGetAccessor:
			case PConst.Kind.memberSetAccessor:
				if (item.kindModifiers.match(/\babstract\b/g)) {
					return super.getSymbolRange(document, item);
				}
				break;
		}
		return null;
	}
}

export function register(
	selector: vscode.DocumentSelector,
	modeId: string,
	client: ITypeScriptServiceClient,
	cachedResponse: CachedNavTreeResponse,
) {
	return new VersionDependentRegistration(client, API.v220, () =>
		new ConfigurationDependentRegistration(modeId, 'implementationsCodeLens.enabled', () => {
			return vscode.languages.registerCodeLensProvider(selector,
				new TypeScriptImplementationsCodeLensProvider(client, cachedResponse));
		}));
}
