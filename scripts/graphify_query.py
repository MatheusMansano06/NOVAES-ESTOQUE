#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Graphify Query Tool - Consulta interativa do grafo de conhecimento NOVAES-ESTOQUE
Uso: python scripts/graphify_query.py <comando> [args]

Exemplos:
  python scripts/graphify_query.py god-nodes              # Top 10 componentes mais conectados
  python scripts/graphify_query.py community MLIntegration # Nodes em uma comunidade
  python scripts/graphify_query.py callers "ml_sync_cache" # Quem chama esta funcao
  python scripts/graphify_query.py calls "ml_sync_cache"   # O que esta funcao chama
  python scripts/graphify_query.py search "estoque"        # Buscar por termo
  python scripts/graphify_query.py related MLIntegration   # Conexoes semanticas
"""

import json
import sys
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Set

# Carrega grafo
GRAPH_FILE = Path(__file__).parent.parent / "graphify-out" / "graph.json"

def load_graph():
    """Carrega o grafo JSON"""
    with open(GRAPH_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def get_node_by_id(nodes, node_id):
    """Encontra um node pelo ID"""
    return next((n for n in nodes if n['id'] == node_id), None)

def get_node_by_name(nodes, name):
    """Encontra um node pelo nome (case-insensitive)"""
    name_lower = name.lower()
    return next((n for n in nodes if name_lower in n.get('label', '').lower() or
                                    name_lower in n.get('id', '').lower()), None)

def show_god_nodes(graph):
    """Mostra top 10 componentes mais conectados"""
    nodes = graph['nodes']
    edges = graph.get('links', graph.get('edges', []))

    # Contar conexoes
    node_connections = defaultdict(int)
    for edge in edges:
        node_connections[edge['source']] += 1
        node_connections[edge['target']] += 1

    # Top 10
    top_nodes = sorted(node_connections.items(), key=lambda x: x[1], reverse=True)[:10]

    print("\n=== GOD NODES - Top 10 Componentes Mais Conectados ===\n")
    print(f"{'#':<3} {'Nome':<40} {'Conexoes':<10}")
    print("-" * 53)

    for i, (node_id, count) in enumerate(top_nodes, 1):
        node = get_node_by_id(nodes, node_id)
        name = node['label'] if node else node_id
        print(f"{i:<3} {name[:39]:<40} {count:<10}")

    print()

def show_community(graph, community_name):
    """Mostra nodes em uma comunidade"""
    nodes = graph['nodes']

    # Busca comunidade
    community_nodes = [n for n in nodes if community_name.lower() in n.get('community', '').lower()]

    if not community_nodes:
        print(f"[ERRO] Comunidade '{community_name}' nao encontrada")
        return

    print(f"\n=== COMUNIDADE: {community_name} ===\n")
    print(f"Total de nodes: {len(community_nodes)}\n")
    print("Nodes:")
    print("-" * 60)

    for node in sorted(community_nodes, key=lambda x: x['label'])[:30]:
        node_type = node.get('type', 'unknown')[:15]
        print(f"  * {node['label'][:50]:<50} [{node_type}]")

    if len(community_nodes) > 30:
        print(f"  ... e mais {len(community_nodes) - 30} nodes")

    print()

def show_callers(graph, function_name):
    """Mostra quem chama uma funcao/modifica uma variavel"""
    nodes = graph['nodes']
    edges = graph.get('links', graph.get('edges', []))

    target_node = get_node_by_name(nodes, function_name)
    if not target_node:
        print(f"[ERRO] Componente '{function_name}' nao encontrado")
        return

    callers = [e['source'] for e in edges if e['target'] == target_node['id']]
    callers_nodes = [get_node_by_id(nodes, c) for c in callers]
    callers_nodes = [n for n in callers_nodes if n]

    print(f"\n=== QUEM CHAMA '{target_node['label']}' ===\n")
    print(f"Total de chamadores: {len(callers_nodes)}\n")

    for node in sorted(callers_nodes, key=lambda x: x['label'])[:20]:
        print(f"  <- {node['label']}")

    if len(callers_nodes) > 20:
        print(f"  ... e mais {len(callers_nodes) - 20}")

    print()

def show_calls(graph, function_name):
    """Mostra o que uma funcao chama"""
    nodes = graph['nodes']
    edges = graph.get('links', graph.get('edges', []))

    source_node = get_node_by_name(nodes, function_name)
    if not source_node:
        print(f"[ERRO] Componente '{function_name}' nao encontrado")
        return

    called = [e['target'] for e in edges if e['source'] == source_node['id']]
    called_nodes = [get_node_by_id(nodes, c) for c in called]
    called_nodes = [n for n in called_nodes if n]

    print(f"\n=== O QUE '{source_node['label']}' CHAMA ===\n")
    print(f"Total de chamadas: {len(called_nodes)}\n")

    for node in sorted(called_nodes, key=lambda x: x['label'])[:20]:
        print(f"  -> {node['label']}")

    if len(called_nodes) > 20:
        print(f"  ... e mais {len(called_nodes) - 20}")

    print()

def search_nodes(graph, term):
    """Busca nodes por termo"""
    nodes = graph['nodes']
    term_lower = term.lower()

    results = [n for n in nodes if term_lower in n['label'].lower() or
                                   term_lower in n.get('id', '').lower()]

    print(f"\n=== BUSCA: '{term}' ===\n")
    print(f"Encontrados: {len(results)} componentes\n")

    for node in sorted(results, key=lambda x: x['label'])[:30]:
        node_type = node.get('type', 'unknown')[:15]
        file_path = node.get('file_path', '')[:30]
        print(f"  * {node['label'][:45]:<45} [{node_type}] {file_path}")

    if len(results) > 30:
        print(f"  ... e mais {len(results) - 30}")

    print()

def show_related(graph, node_name):
    """Mostra relacionamentos semanticos"""
    nodes = graph['nodes']
    edges = graph.get('links', graph.get('edges', []))

    node = get_node_by_name(nodes, node_name)
    if not node:
        print(f"[ERRO] Componente '{node_name}' nao encontrado")
        return

    # Edges semanticos
    semantic_edges = [e for e in edges if
                     e.get('type') in ['semantically_similar_to', 'imports', 'calls']
                     and (e['source'] == node['id'] or e['target'] == node['id'])]

    print(f"\n=== RELACIONADOS: {node['label']} ===\n")
    print(f"Total de relacionamentos: {len(semantic_edges)}\n")

    for edge in semantic_edges[:15]:
        edge_type = edge.get('type', 'related')
        other_id = edge['target'] if edge['source'] == node['id'] else edge['source']
        other_node = get_node_by_id(nodes, other_id)
        if other_node:
            direction = "->" if edge['source'] == node['id'] else "<-"
            print(f"  {direction} {edge_type}: {other_node['label']}")

    if len(semantic_edges) > 15:
        print(f"  ... e mais {len(semantic_edges) - 15}")

    print()

def main():
    """CLI principal"""
    try:
        graph = load_graph()
        edges = graph.get('links', graph.get('edges', []))
        print(f"\n[OK] Grafo carregado: {len(graph['nodes'])} nodes, {len(edges)} edges")

        if len(sys.argv) < 2:
            print(__doc__)
            return

        command = sys.argv[1].lower()

        if command == "god-nodes":
            show_god_nodes(graph)

        elif command == "community":
            if len(sys.argv) < 3:
                print("[ERRO] Uso: graphify_query.py community <nome>")
                return
            show_community(graph, sys.argv[2])

        elif command == "callers":
            if len(sys.argv) < 3:
                print("[ERRO] Uso: graphify_query.py callers <funcao>")
                return
            show_callers(graph, sys.argv[2])

        elif command == "calls":
            if len(sys.argv) < 3:
                print("[ERRO] Uso: graphify_query.py calls <funcao>")
                return
            show_calls(graph, sys.argv[2])

        elif command == "search":
            if len(sys.argv) < 3:
                print("[ERRO] Uso: graphify_query.py search <termo>")
                return
            search_nodes(graph, sys.argv[2])

        elif command == "related":
            if len(sys.argv) < 3:
                print("[ERRO] Uso: graphify_query.py related <componente>")
                return
            show_related(graph, sys.argv[2])

        else:
            print(f"[ERRO] Comando desconhecido: {command}\n")
            print(__doc__)

    except Exception as e:
        print(f"[ERRO] {e}")
        print(f"[INFO] Verifique se o grafo existe em: {GRAPH_FILE}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
