"""Cálculo do desfazer baixa/balanço do inbound FULL (desfaz pela diferença, não por valor absoluto)."""

from app.main import _movimentos_desfazer as f


def test_desfazer_baixa_balanco_e_kit():
    # baixa simples: sai 2 -> volta +2
    assert f("P",2,[])==[{"produto_id":"P","sku":"","ajuste":2}]
    # balanço ok: antes 500, real 498, baixou 2 -> Olist 496; efeito -4 -> desfazer +4
    r=f("P",2,[("balanco_item_full",{"quantidade_real":498,"estoque_antes":500,"sku_inbound":"A"})]); assert r[0]["ajuste"]==4,r
    # divergente e depois baixa simples de 1: antes 10, real 3 (efeito -7), baixa 1 -> desfazer +8
    assert f("P",1,[("balanco_item_full_divergente",{"quantidade_real":3,"estoque_antes":10})])[0]["ajuste"]==8
    # já desfeito antes: log antigo ignorado
    assert f("P",0,[("desfazer_item_full",{}),("balanco_item_full",{"quantidade_real":1,"estoque_antes":9})])==[]
    # kit balanço: comp X ok (antes 10, real 12, baixa 2 -> efeito 0) ; comp Y ok (antes 5, real 4, baixa 4 -> efeito -5 -> +5)
    res=[{"produto_id":"X","status":"ok","quantidade_real":12,"quantidade_baixar":2,"estoque_antes":10},
         {"produto_id":"Y","status":"ok","quantidade_real":4,"quantidade_baixar":4,"estoque_antes":5,"sku":"y"}]
    assert f("K",1,[("balanco_kit_componentes",{"resultados":res})])==[{"produto_id":"Y","sku":"y","ajuste":5}]
    # parcial: Y já revertido -> não repete
    assert f("K",1,[("desfazer_item_full_parcial",{"revertidos":["Y"]}),("balanco_kit_componentes",{"resultados":res})])==[]
    # baixa kit simples
    assert f("K",1,[("baixa_kit_componentes",{"resultados":[{"produto_id":"X","sucesso":True,"quantidade":3}]})])==[{"produto_id":"X","sku":"","ajuste":3}]
